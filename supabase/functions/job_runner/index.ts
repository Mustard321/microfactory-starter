/// <reference lib="deno.ns" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BOARD_ID = 18392861068;
const COL_SYSTEM_STATUS = "color_mkyvf3nn";
const COL_PUBLISHED_URL = "link_mkywkncn";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function mondayGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Monday expects raw token
      authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}: ${text}`);

  const parsed = JSON.parse(text);
  if (parsed.errors?.length) throw new Error(`Monday API error: ${JSON.stringify(parsed.errors)}`);
  return parsed as T;
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
  const valueJsonString = JSON.stringify(valueObj);
  await mondayGraphQL(mondayToken, mutation, {
    itemId,
    boardId,
    colId: columnId,
    val: valueJsonString,
  });
}

async function mondaySetStatusLabel(
  mondayToken: string,
  itemId: number,
  columnId: string,
  label: string,
) {
  await mondayChangeColumnValue(mondayToken, itemId, BOARD_ID, columnId, { label });
}

async function mondaySetLink(
  mondayToken: string,
  itemId: number,
  columnId: string,
  url: string,
  text: string,
) {
  await mondayChangeColumnValue(mondayToken, itemId, BOARD_ID, columnId, { url, text });
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

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  const MONDAY_API_TOKEN = Deno.env.get("MONDAY_API_TOKEN") || "";

  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, error: "Missing Supabase env" }, 500);

  // Require cron secret header
  const got = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET) return json({ ok: false, error: "Missing CRON_SECRET in env" }, 500);
  if (got !== CRON_SECRET) return json({ ok: false, error: "Missing/invalid authorization header" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const lockedBy = `job_runner:${crypto.randomUUID()}`;
  const leaseSeconds = 120;

  // Atomic claim via RPC
  const { data: claimedRaw, error: claimErr } = await supabase.rpc("claim_next_job", {
    p_locked_by: lockedBy,
    p_lease_seconds: leaseSeconds,
  });

  if (claimErr) return json({ ok: false, error: `claim_next_job failed: ${claimErr.message}` }, 500);

  const job = normalizeClaimed(claimedRaw);
  if (!job) return json({ ok: true, message: "no runnable jobs" }, 200);

  const jobId = String(job.id || "");
  const siteSlug = String(job.site_slug || "");
  const jobType = String(job.type || "");

  async function updateMondayForSite(label: string, publishedUrl?: string | null) {
    if (!MONDAY_API_TOKEN) return;

    const { data: siteRow, error: siteRowErr } = await supabase
      .from("sites")
      .select("monday_item_id")
      .eq("slug", siteSlug)
      .maybeSingle();

    if (siteRowErr) return;
    const itemId = Number(siteRow?.monday_item_id || 0);
    if (!itemId) return;

    try {
      await mondaySetStatusLabel(MONDAY_API_TOKEN, itemId, COL_SYSTEM_STATUS, label);
    } catch {
      // ignore
    }

    if (publishedUrl) {
      try {
        await mondaySetLink(MONDAY_API_TOKEN, itemId, COL_PUBLISHED_URL, publishedUrl, "View");
      } catch {
        // ignore
      }
    }
  }

  try {
    await logEvent(
      supabase,
      "JOB_STARTED",
      { type: jobType, locked_by: lockedBy, lease_seconds: leaseSeconds },
      siteSlug,
      jobId,
    );

    if (jobType !== "GENERATE_SITE") throw new Error(`unknown job type: ${jobType}`);

    // Load site row
    const { data: site, error: siteGetErr } = await supabase
      .from("sites")
      .select("slug,title,description,niche,storage_bucket")
      .eq("slug", siteSlug)
      .maybeSingle();

    if (siteGetErr) throw new Error(`site select failed: ${siteGetErr.message}`);
    if (!site) throw new Error(`site not found: ${siteSlug}`);

    // Phase 2: placements (affiliate_url + product_seed_id)
    const { data: placements, error: plcErr } = await supabase
      .from("placements")
      .select("rank,affiliate_url,product_seed_id")
      .eq("site_slug", siteSlug)
      .order("rank", { ascending: true });

    if (plcErr) throw new Error(`placements select failed: ${plcErr.message}`);

    const seedIds = Array.from(
      new Set((placements || []).map((p: any) => p.product_seed_id).filter(Boolean)),
    );

    // pull product_seeds in one query
    const { data: seeds, error: seedErr } = await supabase
      .from("product_seeds")
      .select("id,source_url,title,image_url,price_text")
      .in("id", seedIds.length ? seedIds : ["00000000-0000-0000-0000-000000000000"]);

    if (seedErr) throw new Error(`product_seeds select failed: ${seedErr.message}`);

    const seedById = new Map<string, any>();
    for (const s of seeds || []) seedById.set(String(s.id), s);

    const title = site.title || site.slug;
    const desc = site.description || "";
    const niche = site.niche || "";

    const listItems = (placements || []).map((p: any) => {
      const seed = seedById.get(String(p.product_seed_id)) || {};
      const href = p.affiliate_url || seed.source_url || "#";
      const t = seed.title || seed.source_url || href;
      const price = seed.price_text ? ` — ${escapeHtml(seed.price_text)}` : "";
      return `<li><a href="${escapeHtml(href)}" rel="nofollow noopener" target="_blank">${escapeHtml(t)}</a>${price}</li>`;
    }).join("\n");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main style="max-width: 720px; margin: 40px auto; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.5;">
    <h1>${escapeHtml(title)}</h1>
    <p><strong>Niche:</strong> ${escapeHtml(niche)}</p>
    <p>${escapeHtml(desc)}</p>

    <hr style="margin: 24px 0;" />

    <p style="font-size: 14px; opacity: .75;">
      Affiliate disclosure: This site may contain affiliate links. If you buy through them, we may earn a commission at no additional cost to you.
    </p>

    <h2>Products</h2>
    <ul>
      ${listItems || "<li>No products yet.</li>"}
    </ul>
  </main>
</body>
</html>`;

    const bytes = new TextEncoder().encode(html);

    // Upload to Storage
    const bucket = site.storage_bucket || "sites";
    const storagePath = `${siteSlug}/index.html`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, bytes, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    // Public URL (bucket must be public)
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    const publishedUrl = pub?.publicUrl || null;

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
      { storage_path: storagePath, published_url: publishedUrl, mode: "phase2_placements" },
      siteSlug,
      jobId,
    );

    await updateMondayForSite("Generated", publishedUrl);

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

    return json({ ok: true, job_id: jobId, type: jobType, status: "succeeded" }, 200);
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
      await updateMondayForSite("Failed", null);
    } catch {
      // ignore
    }

    return json({ ok: false, job_id: jobId, type: jobType, status: "failed", error: msg }, 200);
  }
});
