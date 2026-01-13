/// <reference lib="deno.ns" />

import { getServiceClient } from "../_shared/supabase_client.ts";
import { renderSiteHtml } from "../_shared/site_template.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BOARD_ID = 18392861068;
const COL_SYSTEM_STATUS = "color_mkyvf3nn";
const COL_PUBLISHED_URL = "link_mkywkncn";

function safeString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  return "";
}

function domainFromUrl(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function mondayGraphQL(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const t = token.trim();
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${t}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}: ${text}`);

  const parsed = JSON.parse(text);
  if (parsed.errors?.length) throw new Error(`Monday API error: ${JSON.stringify(parsed.errors)}`);
  return parsed;
}

async function mondayChangeColumnValue(
  mondayToken: string,
  itemId: number,
  boardId: number,
  columnId: string,
  valueObj: unknown,
) {
  const mutation = `
    mutation ($itemId: ID!, $boardId: ID!, $colId: String!, $val: JSON!) {
      change_column_value(item_id: $itemId, board_id: $boardId, column_id: $colId, value: $val) { id }
    }
  `;
  const val = JSON.stringify(valueObj);
  await mondayGraphQL(mondayToken, mutation, {
    itemId,
    boardId,
    colId: columnId,
    val,
  });
}

async function mondaySetStatusLabel(mondayToken: string, itemId: number, label: string) {
  await mondayChangeColumnValue(mondayToken, itemId, BOARD_ID, COL_SYSTEM_STATUS, { label });
}

async function mondaySetLink(mondayToken: string, itemId: number, url: string, text: string) {
  await mondayChangeColumnValue(mondayToken, itemId, BOARD_ID, COL_PUBLISHED_URL, { url, text });
}

async function logEvent(
  supabase: any,
  event_type: string,
  payload: any,
  site_slug?: string,
  job_id?: string,
) {
  try {
    await supabase.from("events").insert({
      event_type,
      payload,
      site_slug: site_slug ?? null,
      job_id: job_id ?? null,
    });
  } catch {
    // ignore
  }
}

type ClaimedJob = {
  id: string;
  site_slug: string;
  type: string;
};

function normalizeClaimed(data: any): ClaimedJob | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

async function updateMondayForSite(
  supabase: any,
  mondayToken: string,
  siteSlug: string,
  label: string,
  publishedUrl?: string | null,
) {
  if (!mondayToken) return;

  const { data: siteRow, error: siteRowErr } = await supabase
    .from("sites")
    .select("monday_item_id")
    .eq("slug", siteSlug)
    .maybeSingle();

  if (siteRowErr) return;
  const itemId = Number(siteRow?.monday_item_id || 0);
  if (!itemId) return;

  try {
    await mondaySetStatusLabel(mondayToken, itemId, label);
  } catch {
    // ignore
  }

  if (publishedUrl) {
    try {
      await mondaySetLink(mondayToken, itemId, publishedUrl, "View");
    } catch {
      // ignore
    }
  }
}

async function runOneJob(
  supabase: any,
  mondayToken: string,
  lockedBy: string,
  leaseSeconds: number,
  job: ClaimedJob,
): Promise<{ job_id?: string; site_slug?: string; status?: string; error?: string }> {
  const jobId = String(job.id || "");
  const siteSlug = String(job.site_slug || "");
  const jobType = String(job.type || "");

  try {
    await logEvent(
      supabase,
      "JOB_STARTED",
      { type: jobType, locked_by: lockedBy, lease_seconds: leaseSeconds },
      siteSlug,
      jobId,
    );

    if (jobType !== "GENERATE_SITE") throw new Error(`unknown job type: ${jobType}`);

    // Load site
    const { data: site, error: siteGetErr } = await supabase
      .from("sites")
      .select("slug,title,description,niche,storage_bucket,updated_at")
      .eq("slug", siteSlug)
      .maybeSingle();

    if (siteGetErr) throw new Error(`site select failed: ${siteGetErr.message}`);
    if (!site) throw new Error(`site not found: ${siteSlug}`);

    // Placements
    const { data: placements, error: plcErr } = await supabase
      .from("placements")
      .select("id,rank,affiliate_url,seed_id,product_seed_id")
      .eq("site_slug", siteSlug)
      .order("rank", { ascending: true });

    if (plcErr) throw new Error(`placements select failed: ${plcErr.message}`);

    let clicksByPlacementId = new Map<string, number>();
    const { data: mostClicked, error: mostClickedErr } = await supabase.rpc(
      "most_clicked_placements",
      { p_site_slug: siteSlug, p_days: 30, p_limit: 200 },
    );
    if (mostClickedErr) {
      await logEvent(
        supabase,
        "MOST_CLICKED_RPC_FAILED",
        { error: mostClickedErr.message },
        siteSlug,
        jobId,
      );
    } else {
      clicksByPlacementId = new Map(
        (mostClicked || []).map((row: any) => [String(row.placement_id), Number(row.clicks || 0)]),
      );
    }

    // Prefer product_seed_id if present, else seed_id
    const seedIds = Array.from(
      new Set(
        (placements || [])
          .map((p: any) => p.product_seed_id || p.seed_id)
          .filter(Boolean)
          .map((x: any) => String(x)),
      ),
    );

    const { data: seeds, error: seedErr } = await supabase
      .from("product_seeds")
      .select("id,source_url,title,notes,source_domain,created_at,updated_at")
      .in("id", seedIds.length ? seedIds : ["00000000-0000-0000-0000-000000000000"]);

    if (seedErr) throw new Error(`product_seeds select failed: ${seedErr.message}`);

    const seedById = new Map<string, any>();
    for (const s of seeds || []) seedById.set(String(s.id), s);

    const siteTitle = safeString(site.title) || site.slug;
    const desc = safeString(site.description) || "";
    const niche = safeString(site.niche) || "default";

    const renderedPlacements = (placements || []).map((p: any) => {
      const sid = String(p.product_seed_id || p.seed_id || "");
      const seed = seedById.get(sid) || {};
      const placementId = safeString(p.id);
      const href = safeString(p.affiliate_url) || safeString(seed.source_url) || "#";
      const ctaHref = placementId
        ? `https://ndzrxomconvvrvwkgnor.functions.supabase.co/track_click?p=${encodeURIComponent(placementId)}`
        : href;

      const title = safeString(seed.title) || safeString(seed.source_url) || href;
      const note = safeString(seed.notes) || ""; // keep note clean; template has default fallback copy
      const domain = safeString(seed.source_domain) || domainFromUrl(href);
      const clicks = placementId ? clicksByPlacementId.get(placementId) ?? 0 : 0;

      return {
        title,
        note: note || undefined,
        domain,
        href: ctaHref,
        copyHref: href,
        createdIso: safeString(seed.created_at) || undefined,
        rank: typeof p.rank === "number" ? p.rank : undefined,
        clicks,
      };
    });

    const html = renderSiteHtml({
      siteTitle,
      siteSlug,
      niche,
      subtitle: desc || undefined,
      updatedIso: safeString(site.updated_at) || new Date().toISOString(),
      placements: renderedPlacements,
    });

    const bytes = new TextEncoder().encode(html);

    // Upload to Storage
    const bucket = safeString(site.storage_bucket) || "sites";
    const storagePath = `${siteSlug}/index.html`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, bytes, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    // ✅ Stable published URL for Safari: serve via Edge Function
    const publishedUrl =
      `https://ndzrxomconvvrvwkgnor.functions.supabase.co/site_public/${encodeURIComponent(siteSlug)}`;

    // Update site row
    const { error: siteUpdErr } = await supabase
      .from("sites")
      .update({
        status: "generated",
        storage_bucket: bucket,
        storage_path: storagePath,
        published_url: publishedUrl,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("slug", siteSlug);

    if (siteUpdErr) throw new Error(`site update failed: ${siteUpdErr.message}`);

    await logEvent(
      supabase,
      "SITE_GENERATED",
      { storage_path: storagePath, published_url: publishedUrl, mode: "template_v1" },
      siteSlug,
      jobId,
    );

    await updateMondayForSite(supabase, mondayToken, siteSlug, "Generated", publishedUrl);

    // Mark job success
    const { error: jobUpdErr } = await supabase
      .from("jobs")
      .update({
        status: "succeeded",
        run_finished_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (jobUpdErr) throw new Error(`jobs update failed: ${jobUpdErr.message}`);

    await logEvent(supabase, "JOB_SUCCEEDED", { type: jobType }, siteSlug, jobId);

    return { job_id: jobId, site_slug: siteSlug, status: "succeeded" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    await supabase
      .from("jobs")
      .update({
        status: "failed",
        run_finished_at: new Date().toISOString(),
        last_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await logEvent(supabase, "JOB_FAILED", { type: jobType, error: msg }, siteSlug, jobId);

    try {
      await updateMondayForSite(supabase, mondayToken, siteSlug, "Failed", null);
    } catch {
      // ignore
    }

    // Keep 200-level success for runner responses; job is marked failed in DB.
    return { job_id: jobId, site_slug: siteSlug, status: "failed", error: msg };
  }
}

Deno.serve(async (req) => {
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  const MONDAY_API_TOKEN = Deno.env.get("MONDAY_API_TOKEN") || "";

  const got = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET) return json({ ok: false, error: "Missing CRON_SECRET in env" }, 500);
  if (got !== CRON_SECRET) return json({ ok: false, error: "Missing/invalid authorization header" }, 401);

  let supabase: any;
  try {
    supabase = getServiceClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }

  const nowIso = new Date().toISOString();
  const lockedBy = `job_runner:${crypto.randomUUID()}`;
  const leaseSeconds = 120;

  await logEvent(
    supabase,
    "CRON_TICK",
    { locked_by: lockedBy, lease_seconds: leaseSeconds, at: nowIso },
    null,
    null,
  );

  const safetyBufferMs = 10_000; // 10s
  const startMs = Date.now();

  const results: any[] = [];
  let processedCount = 0;

  while (true) {
    const elapsedMs = Date.now() - startMs;
    if (elapsedMs > leaseSeconds * 1000 - safetyBufferMs) break;

    const { data: claimedRaw, error: claimErr } = await supabase.rpc("claim_next_job", {
      p_locked_by: lockedBy,
      p_lease_seconds: leaseSeconds,
    });

    if (claimErr) {
      results.push({ status: "claim_failed", error: claimErr.message });
      break;
    }

    const job = normalizeClaimed(claimedRaw);
    if (!job) break;

    const r = await runOneJob(supabase, MONDAY_API_TOKEN, lockedBy, leaseSeconds, job);
    results.push(r);
    processedCount += 1;
  }

  return json(
    {
      ok: true,
      locked_by: lockedBy,
      lease_seconds: leaseSeconds,
      ticked: true,
      tick_at: nowIso,
      processed: processedCount,
      results,
    },
    200,
  );
});
