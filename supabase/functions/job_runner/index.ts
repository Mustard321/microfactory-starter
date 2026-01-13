/// <reference lib="deno.ns" />

import { getServiceClient } from "../_shared/supabase_client.ts";
import {
  mondayChangeColumnValue,
  resolveColumnIdsByTitle,
  writebackAttempt,
  writebackFailed,
  writebackSuccess,
} from "../_shared/monday_writeback.ts";
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

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PinterestBoardConfig = {
  board_id: string;
  board_name: string;
};

function parsePinterestBoardMap(raw: string): Record<string, PinterestBoardConfig> {
  try {
    const parsed = JSON.parse(raw || "{}");
    const out: Record<string, PinterestBoardConfig> = {};
    for (const [key, val] of Object.entries(parsed || {})) {
      const k = String(key || "").toLowerCase();
      if (!k) continue;
      if (typeof val === "string") {
        out[k] = { board_id: val, board_name: key };
      } else if (val && typeof val === "object") {
        const v: any = val;
        if (v.board_id && v.board_name) {
          out[k] = { board_id: String(v.board_id), board_name: String(v.board_name) };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
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
  if (!mondayToken) {
    await writebackFailed(
      supabase,
      {
        source: "job_runner",
        monday_item_id: null,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: {},
        intended: { status: label, published_url: publishedUrl || null, site_slug: siteSlug },
      },
      "missing monday token",
    );
    return;
  }

  const { data: siteRow, error: siteRowErr } = await supabase
    .from("sites")
    .select("monday_item_id")
    .eq("slug", siteSlug)
    .maybeSingle();

  if (siteRowErr) {
    await writebackFailed(
      supabase,
      {
        source: "job_runner",
        monday_item_id: null,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: {},
        intended: { status: label, published_url: publishedUrl || null, site_slug: siteSlug },
      },
      siteRowErr.message,
    );
    return;
  }
  const itemId = Number(siteRow?.monday_item_id || 0);
  if (!itemId) {
    await writebackFailed(
      supabase,
      {
        source: "job_runner",
        monday_item_id: null,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: {},
        intended: { status: label, published_url: publishedUrl || null, site_slug: siteSlug },
      },
      "missing monday_item_id",
    );
    return;
  }

  let resolved: any = {};
  try {
    resolved = await resolveColumnIdsByTitle(mondayToken, BOARD_ID, {
      siteSlugTitle: ["Site Slug", "site_slug", "Slug"],
      statusTitle: ["System Status", "Status", "system_status"],
      publishedUrlTitle: ["Published URL", "Published Link", "URL", "What is this?"],
    });
    if (!resolved.statusColId) {
      await writebackFailed(
        supabase,
        {
          source: "job_runner",
          monday_item_id: itemId,
          site_slug: siteSlug,
          board_id: BOARD_ID,
          resolved: { titles: resolved.titles },
          intended: { status: label },
        },
        "missing column: System Status",
      );
    }
    if (!resolved.siteSlugColId) {
      await writebackFailed(
        supabase,
        {
          source: "job_runner",
          monday_item_id: itemId,
          site_slug: siteSlug,
          board_id: BOARD_ID,
          resolved: { titles: resolved.titles },
          intended: { site_slug: siteSlug },
        },
        "missing column: Site Slug",
      );
    }
    if (publishedUrl && !resolved.publishedUrlColId) {
      await writebackFailed(
        supabase,
        {
          source: "job_runner",
          monday_item_id: itemId,
          site_slug: siteSlug,
          board_id: BOARD_ID,
          resolved: { titles: resolved.titles },
          intended: { published_url: publishedUrl },
        },
        "missing column: Published URL",
      );
    }
  } catch (e) {
    await writebackFailed(
      supabase,
      {
        source: "job_runner",
        monday_item_id: itemId,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: {},
        intended: { status: label, published_url: publishedUrl || null, site_slug: siteSlug },
      },
      e instanceof Error ? e.message : String(e),
    );
    return;
  }

  const statusCol = resolved.statusColId || COL_SYSTEM_STATUS;
  const publishedCol = resolved.publishedUrlColId || COL_PUBLISHED_URL;
  const slugCol = resolved.siteSlugColId || COL_SLUG;

  await writebackAttempt(supabase, {
    source: "job_runner",
    monday_item_id: itemId,
    site_slug: siteSlug,
    board_id: BOARD_ID,
    resolved,
    intended: { status: label },
  });
  try {
    await mondayChangeColumnValue(mondayToken, itemId, BOARD_ID, statusCol, { label });
    await writebackSuccess(supabase, {
      source: "job_runner",
      monday_item_id: itemId,
      site_slug: siteSlug,
      board_id: BOARD_ID,
      resolved: { statusColId: statusCol },
      intended: { status: label },
    });
  } catch (e) {
    await writebackFailed(
      supabase,
      {
        source: "job_runner",
        monday_item_id: itemId,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: { statusColId: statusCol, titles: resolved.titles },
        intended: { status: label },
      },
      e instanceof Error ? e.message : String(e),
    );
  }

  await writebackAttempt(supabase, {
    source: "job_runner",
    monday_item_id: itemId,
    site_slug: siteSlug,
    board_id: BOARD_ID,
    resolved,
    intended: { site_slug: siteSlug },
  });
  try {
    await mondayChangeColumnValue(mondayToken, itemId, BOARD_ID, slugCol, siteSlug);
    await writebackSuccess(supabase, {
      source: "job_runner",
      monday_item_id: itemId,
      site_slug: siteSlug,
      board_id: BOARD_ID,
      resolved: { siteSlugColId: slugCol },
      intended: { site_slug: siteSlug },
    });
  } catch (e) {
    await writebackFailed(
      supabase,
      {
        source: "job_runner",
        monday_item_id: itemId,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: { siteSlugColId: slugCol, titles: resolved.titles },
        intended: { site_slug: siteSlug },
      },
      e instanceof Error ? e.message : String(e),
    );
  }

  if (publishedUrl) {
    const useText = (resolved.publishedUrlTitle || "").toLowerCase() === "what is this?";
    await writebackAttempt(supabase, {
      source: "job_runner",
      monday_item_id: itemId,
      site_slug: siteSlug,
      board_id: BOARD_ID,
      resolved,
      intended: { published_url: publishedUrl },
    });
    try {
      await mondayChangeColumnValue(
        mondayToken,
        itemId,
        BOARD_ID,
        publishedCol,
        useText ? publishedUrl : { url: publishedUrl, text: "View" },
      );
      await writebackSuccess(supabase, {
        source: "job_runner",
        monday_item_id: itemId,
        site_slug: siteSlug,
        board_id: BOARD_ID,
        resolved: { publishedUrlColId: publishedCol },
        intended: { published_url: publishedUrl },
      });
    } catch (e) {
      await writebackFailed(
        supabase,
        {
          source: "job_runner",
          monday_item_id: itemId,
          site_slug: siteSlug,
          board_id: BOARD_ID,
          resolved: { publishedUrlColId: publishedCol, titles: resolved.titles },
          intended: { published_url: publishedUrl },
        },
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

async function queuePinterestJob(supabase: any, siteSlug: string) {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("site_slug", siteSlug)
    .eq("type", "PUBLISH_PINTEREST")
    .in("status", ["queued", "running", "retrying"])
    .maybeSingle();

  if (data?.id) return data.id;

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      site_slug: siteSlug,
      type: "PUBLISH_PINTEREST",
      status: "queued",
      attempts: 0,
      next_run_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`pinterest job insert failed: ${error.message}`);
  return job.id;
}

async function logPinEvent(
  supabase: any,
  event_type: string,
  payload: any,
  site_slug?: string,
) {
  try {
    await supabase.from("events").insert({
      event_type,
      payload,
      site_slug: site_slug ?? null,
      job_id: null,
    });
  } catch {
    // ignore
  }
}

async function publishPinterestPins(
  supabase: any,
  siteSlug: string,
) {
  const PINTEREST_ACCESS_TOKEN = Deno.env.get("PINTEREST_ACCESS_TOKEN") || "";
  const PINTEREST_APP_ID = Deno.env.get("PINTEREST_APP_ID") || "";
  const PINTEREST_APP_SECRET = Deno.env.get("PINTEREST_APP_SECRET") || "";
  const rawBoardMap = Deno.env.get("PINTEREST_BOARD_MAP") || "";
  const placeholderImage = Deno.env.get("PINTEREST_PLACEHOLDER_IMAGE_URL") || "";
  const maxPins = Math.max(1, Math.min(50, Number(Deno.env.get("PINTEREST_MAX_PINS") || "20")));
  const delayMs = Math.max(0, Number(Deno.env.get("PINTEREST_DELAY_MS") || "250"));

  if (!PINTEREST_ACCESS_TOKEN || !PINTEREST_APP_ID || !PINTEREST_APP_SECRET) {
    await logPinEvent(
      supabase,
      "PIN_FAILED",
      {
        site_slug: siteSlug,
        placement_id: null,
        board_name: null,
        error: "missing pinterest credentials",
      },
      siteSlug,
    );
    throw new Error("missing pinterest credentials");
  }

  const boardMap = parsePinterestBoardMap(rawBoardMap);

  const { data: siteRow, error: siteErr } = await supabase
    .from("sites")
    .select("slug,niche")
    .eq("slug", siteSlug)
    .maybeSingle();

  if (siteErr) throw new Error(`site select failed: ${siteErr.message}`);
  if (!siteRow) throw new Error(`site not found: ${siteSlug}`);

  const niche = safeString(siteRow.niche) || "default";
  const board = boardMap[niche.toLowerCase()];
  if (!board) {
    await logPinEvent(
      supabase,
      "PIN_FAILED",
      {
        site_slug: siteSlug,
        placement_id: null,
        board_name: null,
        niche,
        error: "missing board mapping",
      },
      siteSlug,
    );
    throw new Error("missing board mapping");
  }

  const { data: placements, error: plcErr } = await supabase
    .from("placements")
    .select("id,rank,affiliate_url,seed_id,product_seed_id")
    .eq("site_slug", siteSlug)
    .order("rank", { ascending: true })
    .limit(maxPins);

  if (plcErr) throw new Error(`placements select failed: ${plcErr.message}`);

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
    .select("id,title,source_url,image_url")
    .in("id", seedIds.length ? seedIds : ["00000000-0000-0000-0000-000000000000"]);

  if (seedErr) throw new Error(`product_seeds select failed: ${seedErr.message}`);

  const seedById = new Map<string, any>();
  for (const s of seeds || []) seedById.set(String(s.id), s);

  for (const p of placements || []) {
    const placementId = String(p.id || "");
    const sid = String(p.product_seed_id || p.seed_id || "");
    const seed = seedById.get(sid) || {};
    const titleRaw = safeString(seed.title) || safeString(seed.source_url) || "Product";
    const title = `${titleRaw} | ${niche}`;
    const description = `Quick pick for ${niche}. Clean link inside. Save for later.`;
    const linkUrl = placementId
      ? `https://ndzrxomconvvrvwkgnor.functions.supabase.co/track_click?p=${encodeURIComponent(placementId)}`
      : "";
    const imageUrl = safeString(seed.image_url) || placeholderImage;

    if (!linkUrl || !isHttpUrl(linkUrl)) {
      await logPinEvent(
        supabase,
        "PIN_FAILED",
        { site_slug: siteSlug, placement_id: placementId, board_name: board.board_name, niche, error: "invalid link url" },
        siteSlug,
      );
      continue;
    }
    if (!imageUrl || !isHttpUrl(imageUrl)) {
      await logPinEvent(
        supabase,
        "PIN_FAILED",
        { site_slug: siteSlug, placement_id: placementId, board_name: board.board_name, niche, error: "missing image url" },
        siteSlug,
      );
      continue;
    }

    const res = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${PINTEREST_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        board_id: board.board_id,
        title,
        description,
        link: linkUrl,
        media_source: {
          source_type: "image_url",
          url: imageUrl,
        },
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      await logPinEvent(
        supabase,
        "PIN_FAILED",
        {
          site_slug: siteSlug,
          placement_id: placementId,
          board_name: board.board_name,
          niche,
          error: text.slice(0, 300),
        },
        siteSlug,
      );
    } else {
      let pinId = "";
      try {
        const parsed = JSON.parse(text);
        pinId = String(parsed?.id || "");
      } catch {
        // ignore
      }
      await logPinEvent(
        supabase,
        "PIN_PUBLISHED",
        {
          site_slug: siteSlug,
          placement_id: placementId,
          board_name: board.board_name,
          niche,
          pin_id: pinId || null,
        },
        siteSlug,
      );
    }

    if (delayMs) await sleep(delayMs);
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

    if (jobType === "PUBLISH_PINTEREST") {
      await publishPinterestPins(supabase, siteSlug);

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
    }

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

    try {
      await queuePinterestJob(supabase, siteSlug);
    } catch {
      // ignore
    }

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
  if (!CRON_SECRET || got !== CRON_SECRET) {
    return json(
      { ok: false, error: "CRON_SECRET missing in shell or does not match Supabase secret" },
      401,
    );
  }

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
