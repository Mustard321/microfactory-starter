/// <reference lib="deno.ns" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * MONDAY CONFIG
 */
const MONDAY_BOARD_ID = 18392861068;

// Trigger column (Approval)
const COL_APPROVAL = "color_mkyvzaeq";
const APPROVED_INDEX = 1;

// Data columns
const COL_SLUG = "text_mkyvmaza";
const COL_TITLE = "text_mkyvs741";
const COL_DESC = "long_text_mkyvrh7p";
const COL_NICHE = "dropdown_mkyvggbk";

// Single link column
const COL_SOURCE_LINK = "link_mkyv2h27";

// Multi links column (long text)
const COL_SOURCE_LINKS_MULTI = "long_text_mkywmd1v";

// System Status column
const COL_SYSTEM_STATUS = "color_mkyvf3nn";

/**
 * Helpers
 */
function safeString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  return "";
}

function slugify(raw: string): string {
  const s = safeString(raw).toLowerCase();
  return s
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function shortId(): string {
  return crypto.randomUUID().split("-")[0];
}

function parseApprovalIndex(value: any): number | null {
  try {
    if (!value) return null;
    if (typeof value === "string") {
      const parsed = JSON.parse(value);
      if (typeof parsed?.index === "number") return parsed.index;
      return null;
    }
    if (typeof value?.label?.index === "number") return value.label.index;
    if (typeof value?.index === "number") return value.index;
    return null;
  } catch {
    return null;
  }
}

function extractLinkUrlText(value: any): { url: string; text: string } {
  try {
    if (!value) return { url: "", text: "" };
    const v = typeof value === "string" ? JSON.parse(value) : value;
    const url = safeString(v?.url);
    const text = safeString(v?.text);
    return { url, text };
  } catch {
    return { url: "", text: "" };
  }
}

function fallbackTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url ? "Link" : "Unknown";
  }
}

function splitUrls(raw: string): string[] {
  return safeString(raw)
    .split(/\r?\n|,|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
}

function domainFromUrl(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isSchemaCacheError(msg: string): boolean {
  return msg.includes("schema cache") || msg.includes("Could not find the");
}

async function reloadSchemaCacheBestEffort(supabase: any) {
  try {
    await supabase.rpc("notify", { channel: "pgrst", payload: "reload schema" });
  } catch {
    // ignore
  }
}

async function withSchemaRetry<T>(supabase: any, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isSchemaCacheError(msg)) throw e;
    await reloadSchemaCacheBestEffort(supabase);
    return await fn();
  }
}

async function mondayGraphQL(
  mondayToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: mondayToken },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}: ${text}`);

  const parsed = JSON.parse(text);
  if (parsed.errors?.length) throw new Error(`Monday API error: ${JSON.stringify(parsed.errors)}`);
  return parsed;
}

async function mondaySetSystemStatus(mondayToken: string, itemId: number, label: string) {
  const mutation = `
    mutation ($itemId: ID!, $boardId: ID!, $colId: String!, $val: JSON!) {
      change_column_value(item_id: $itemId, board_id: $boardId, column_id: $colId, value: $val) { id }
    }
  `;
  const valueJsonString = JSON.stringify({ label });
  await mondayGraphQL(mondayToken, mutation, {
    itemId,
    boardId: MONDAY_BOARD_ID,
    colId: COL_SYSTEM_STATUS,
    val: valueJsonString,
  });
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

async function fetchMondayItem(mondayToken: string, itemId: number) {
  const query = `
    query ($itemId: [ID!]) {
      items(ids: $itemId) {
        id
        name
        column_values { id text value }
      }
    }
  `;
  const out = await mondayGraphQL(mondayToken, query, { itemId: [String(itemId)] });
  const item = out?.data?.items?.[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const cols: Record<string, { text: string; value: any }> = {};
  for (const cv of item.column_values || []) {
    let parsedValue: any = null;
    try {
      parsedValue = cv.value ? (typeof cv.value === "string" ? JSON.parse(cv.value) : cv.value) : null;
    } catch {
      parsedValue = null;
    }
    cols[cv.id] = { text: safeString(cv.text), value: parsedValue };
  }

  const rawSlug = cols[COL_SLUG]?.text || "";
  const slug = slugify(rawSlug);

  const title = cols[COL_TITLE]?.text || item.name || "";
  const description = cols[COL_DESC]?.text || "";
  const niche = cols[COL_NICHE]?.text || "";

  const linkRawValue = (cols[COL_SOURCE_LINK]?.value ?? null);
  const link = extractLinkUrlText(linkRawValue);
  const sourceLinksMultiText = cols[COL_SOURCE_LINKS_MULTI]?.text || "";

  return {
    monday_item_id: Number(item.id),
    raw_slug: rawSlug,
    slug,
    title,
    description,
    niche,
    source_link_url: link.url,
    source_link_text: link.text,
    source_links_multi_text: sourceLinksMultiText,
  };
}

async function queueGenerateSiteJob(supabase: any, site_slug: string) {
  // avoid duplicates
  const { data: existingJob } = await supabase
    .from("jobs")
    .select("id,status")
    .eq("site_slug", site_slug)
    .eq("type", "GENERATE_SITE")
    .in("status", ["queued", "running", "retrying"])
    .maybeSingle();

  if (existingJob?.id) return existingJob.id;

  const { data: newJob, error: jobErr } = await supabase.from("jobs").insert({
    site_slug,
    type: "GENERATE_SITE",
    status: "queued",
    attempts: 0,
    next_run_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("id").single();

  if (jobErr) throw new Error(`job insert failed: ${jobErr.message}`);
  return newJob.id;
}

async function getActiveTargetsForNiche(supabase: any, niche: string): Promise<string[]> {
  const clean = safeString(niche);
  if (!clean) return [];
  const { data, error } = await supabase
    .from("site_targets")
    .select("slug")
    .eq("niche", clean)
    .eq("is_active", true);

  if (error) throw new Error(`site_targets select failed: ${error.message}`);
  return (data || []).map((r: any) => String(r.slug));
}

async function ensureLegacySiteRow(
  supabase: any,
  site_slug: string,
  title: string,
  description: string,
  niche: string,
  monday_item_id: number | null,
  source_links_text: string,
) {
  await withSchemaRetry(supabase, async () => {
    const { error } = await supabase.from("sites").upsert({
      slug: site_slug,
      title,
      description,
      niche,
      status: "queued",
      source_links_text,
      monday_item_id,
      intake_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "slug" });

    if (error) throw new Error(`sites upsert failed: ${error.message}`);
    return true;
  });
}

async function insertLegacyProducts(
  supabase: any,
  site_slug: string,
  urls: string[],
) {
  if (!urls.length) return;

  // append at end of list for that site
  const { data: maxRow, error: maxErr } = await supabase
    .from("products")
    .select("rank")
    .eq("site_slug", site_slug)
    .order("rank", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) throw new Error(`products max rank failed: ${maxErr.message}`);
  const baseRank = Number(maxRow?.rank || 0);

  const products = urls.map((u, i) => ({
    site_slug,
    rank: baseRank + i + 1,
    title: fallbackTitleFromUrl(u),
    source_url: u,
    affiliate_url: u,
    url: u,
    price_text: null,
    image_url: null,
  }));

  await withSchemaRetry(supabase, async () => {
    const { error } = await supabase.from("products").upsert(products, {
      onConflict: "site_slug,rank",
    });
    if (error) throw new Error(`products upsert failed: ${error.message}`);
    return true;
  });
}

async function upsertSeedsAndPlacements(
  supabase: any,
  niche: string,
  urls: string[],
  targetSiteSlugs: string[],
) {
  if (!urls.length) return;

  // Preload current max rank per site for placements
  const maxBySite: Record<string, number> = {};
  for (const siteSlug of targetSiteSlugs) {
    const { data: m, error: e } = await supabase
      .from("placements")
      .select("rank")
      .eq("site_slug", siteSlug)
      .order("rank", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e) throw new Error(`placements max rank failed for ${siteSlug}: ${e.message}`);
    maxBySite[siteSlug] = Number(m?.rank || 0);
  }

  for (const url of urls) {
    const domain = domainFromUrl(url);
    if (!domain) continue;

    // upsert seed
    const { data: seed, error: seedErr } = await supabase
      .from("product_seeds")
      .upsert({
        source_url: url,
        source_domain: domain,
        niche: niche || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "source_url" })
      .select("id")
      .single();

    if (seedErr) throw new Error(`product_seeds upsert failed: ${seedErr.message}`);

    // create one placement per site target
    const placements = targetSiteSlugs.map((siteSlug) => {
      const nextRank = (maxBySite[siteSlug] || 0) + 1;
      maxBySite[siteSlug] = nextRank;
      return {
        seed_id: seed.id,
        site_slug: siteSlug,
        rank: nextRank,
        affiliate_url: url,      // Phase 2 later: transform per program
        program_code: null,
        status: "queued",
        updated_at: new Date().toISOString(),
      };
    });

    const { error: pErr } = await supabase
      .from("placements")
      .upsert(placements, { onConflict: "site_slug,seed_id" });

    if (pErr) throw new Error(`placements upsert failed: ${pErr.message}`);
  }
}

/**
 * Main handler
 */
Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const MONDAY_API_TOKEN = Deno.env.get("MONDAY_API_TOKEN") || "";
  const MONDAY_WEBHOOK_TOKEN = Deno.env.get("MONDAY_WEBHOOK_TOKEN") || "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Missing Supabase env vars" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Monday handshake
  try {
    const raw = await req.clone().json().catch(() => null);
    if (raw?.challenge) return json({ challenge: raw.challenge }, 200);
  } catch {
    // ignore
  }

  // Token gate (query param)
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!MONDAY_WEBHOOK_TOKEN) return json({ ok: false, error: "Missing env: MONDAY_WEBHOOK_TOKEN" }, 500);
  if (token !== MONDAY_WEBHOOK_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid json" }, 400);

  const event = body.event ?? null;

  /**
   * Manual mode (curl testing)
   */
  if (!event) {
    const rawTitle = safeString(body.title) || "untitled";
    const rawNiche = safeString(body.niche) || "";
    const description = safeString(body.description) || "";
    const source_links_text = safeString(body.source_links_text || body.source_links || "");
    const urls = splitUrls(source_links_text);

    // slug can be provided, otherwise auto-generate from title
    const providedSlug = safeString(body.slug);
    const slug = slugify(providedSlug || rawTitle) || `site-${shortId()}`;

    await logEvent(supabase, "INTAKE_RECEIVED", {
      mode: "manual",
      slug,
      niche: rawNiche,
      title: rawTitle,
      description,
      source_links_text,
      url_count: urls.length,
    }, slug);

    // fan-out targets
    const targets = await getActiveTargetsForNiche(supabase, rawNiche).catch(() => []);
    const siteSlugs = targets.length ? targets : [slug];

    // phase2: seeds+placements
    await upsertSeedsAndPlacements(supabase, rawNiche, urls, siteSlugs);

    // legacy: create sites/products per site
    for (const siteSlug of siteSlugs) {
      await ensureLegacySiteRow(
        supabase,
        siteSlug,
        rawTitle || siteSlug,
        description,
        rawNiche,
        null,
        source_links_text,
      );
      await insertLegacyProducts(supabase, siteSlug, urls);

      const jobId = await queueGenerateSiteJob(supabase, siteSlug);
      await logEvent(supabase, "JOB_QUEUED", { site_slug: siteSlug, job_id: jobId }, siteSlug, jobId);
    }

    return json({ ok: true, mode: "manual", sites: siteSlugs, queued: siteSlugs.length }, 200);
  }

  /**
   * Monday webhook mode
   */
  await logEvent(supabase, "MONDAY_WEBHOOK_RECEIVED", { event });

  if (event?.boardId !== MONDAY_BOARD_ID) return json({ ok: true, ignored: "wrong board" }, 200);
  if (event?.columnId !== COL_APPROVAL) return json({ ok: true, ignored: "not approval column" }, 200);

  const approvalIndex = parseApprovalIndex(event?.value);
  if (approvalIndex !== APPROVED_INDEX) {
    return json({ ok: true, ignored: `approval index ${approvalIndex} != ${APPROVED_INDEX}` }, 200);
  }

  if (!MONDAY_API_TOKEN) return json({ ok: false, error: "Missing env: MONDAY_API_TOKEN" }, 500);

  const itemId = Number(event?.pulseId || 0);
  if (!itemId) return json({ ok: false, error: "Missing pulseId/itemId" }, 400);

  try {
    await mondaySetSystemStatus(MONDAY_API_TOKEN, itemId, "Processing");
  } catch {
    // ignore
  }

  try {
    const item = await fetchMondayItem(MONDAY_API_TOKEN, itemId);

    const title = safeString(item.title) || `Item ${item.monday_item_id}`;
    const description = safeString(item.description) || "";
    const niche = safeString(item.niche) || "";

    const multiText = safeString(item.source_links_multi_text);
    const singleUrl = safeString(item.source_link_url);
    const singleText = safeString(item.source_link_text);
    const source_links_text = multiText || singleUrl || singleText || "";

    const urls = splitUrls(source_links_text);

    // Wanda DOES NOT need to manage slug; we ignore COL_SLUG for farm fan-out
    const targets = await getActiveTargetsForNiche(supabase, niche).catch(() => []);
    const siteSlugs = targets.length ? targets : [slugify(title) || `site-${shortId()}`];

    await logEvent(supabase, "INTAKE_RECEIVED", {
      mode: "monday",
      niche,
      title,
      description,
      monday_item_id: item.monday_item_id,
      url_count: urls.length,
      targets: siteSlugs.length,
    });

    // phase2: seeds+placements
    await upsertSeedsAndPlacements(supabase, niche, urls, siteSlugs);

    // legacy: create sites/products per site and queue jobs
    for (const siteSlug of siteSlugs) {
      await ensureLegacySiteRow(
        supabase,
        siteSlug,
        title,
        description,
        niche,
        item.monday_item_id,
        source_links_text,
      );
      await insertLegacyProducts(supabase, siteSlug, urls);

      const jobId = await queueGenerateSiteJob(supabase, siteSlug);
      await logEvent(supabase, "JOB_QUEUED", { site_slug: siteSlug, job_id: jobId }, siteSlug, jobId);
    }

    try {
      await mondaySetSystemStatus(MONDAY_API_TOKEN, itemId, "Queued");
    } catch {
      // ignore
    }

    return json({ ok: true, monday_item_id: item.monday_item_id, queued_sites: siteSlugs.length }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent(supabase, "INTAKE_FAILED", { error: msg, itemId });

    try {
      await mondaySetSystemStatus(MONDAY_API_TOKEN, itemId, "Failed");
    } catch {
      // ignore
    }

    return json({ ok: false, error: msg }, 200);
  }
});
