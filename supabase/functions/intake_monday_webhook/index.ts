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
  // supports: one per line, commas, or spaces
  return safeString(raw)
    .split(/\r?\n|,|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
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
    return await fn(); // retry once
  }
}

async function mondayGraphQL(
  mondayToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: mondayToken }, // raw token
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

  // Token gate
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!MONDAY_WEBHOOK_TOKEN) return json({ ok: false, error: "Missing env: MONDAY_WEBHOOK_TOKEN" }, 500);
  if (token !== MONDAY_WEBHOOK_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid json" }, 400);

  const event = body.event ?? null;

  /**
   * Manual mode (for curl testing)
   */
  if (!event && body.slug) {
    const rawSlug = safeString(body.slug);
    const slug = slugify(rawSlug);
    const title = safeString(body.title) || slug || "untitled";
    const description = safeString(body.description) || ""; // sites.description is NOT NULL
    const niche = safeString(body.niche) || ""; // sites.niche is NOT NULL
    const source_links_text = safeString(body.source_links_text);

    await logEvent(supabase, "INTAKE_RECEIVED", {
      mode: "manual",
      raw_slug: rawSlug,
      slug,
      niche,
      title,
      description,
      source_links_text,
    }, slug);

    if (!slug) return json({ ok: false, error: "Missing/invalid slug" }, 400);

    await withSchemaRetry(supabase, async () => {
      const { error } = await supabase.from("sites").upsert({
        slug,
        title,
        description,
        niche,
        status: "queued",
        source_links_text,
        monday_item_id: null,
        intake_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "slug" });
      if (error) throw new Error(`site upsert failed: ${error.message}`);
      return true;
    });

    await logEvent(supabase, "SITE_UPSERTED", { mode: "manual", slug }, slug);

    const links = splitUrls(source_links_text);
    const products = links.map((u: string, i: number) => ({
      site_slug: slug,
      rank: i + 1,
      title: fallbackTitleFromUrl(u), // NOT NULL safe
      source_url: u,
      affiliate_url: u, // NOT NULL
      url: u,
      price_text: null,
      image_url: null,
    }));

    if (products.length) {
      await withSchemaRetry(supabase, async () => {
        const { error } = await supabase.from("products").upsert(products, {
          onConflict: "site_slug,rank",
        });
        if (error) throw new Error(`products upsert failed: ${error.message}`);
        return true;
      });
      await logEvent(supabase, "PRODUCTS_UPSERTED", { mode: "manual", slug, count: products.length }, slug);
    } else {
      await logEvent(supabase, "PRODUCTS_SKIPPED", { mode: "manual", slug, reason: "no valid urls" }, slug);
    }

    // queue job (avoid duplicates)
    const { data: existingJob } = await supabase
      .from("jobs")
      .select("id,status")
      .eq("site_slug", slug)
      .eq("type", "GENERATE_SITE")
      .in("status", ["queued", "running", "retrying"])
      .maybeSingle();

    if (existingJob?.id) {
      await logEvent(supabase, "JOB_ALREADY_EXISTS", { mode: "manual", slug, job_id: existingJob.id }, slug, existingJob.id);
      return json({ ok: true, slug, job_id: existingJob.id, message: "job already queued/running" }, 200);
    }

    const { data: newJob, error: jobErr } = await supabase.from("jobs").insert({
      site_slug: slug,
      type: "GENERATE_SITE",
      status: "queued",
      attempts: 0,
      next_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("id").single();

    if (jobErr) return json({ ok: false, error: `job insert failed: ${jobErr.message}` }, 500);

    return json({ ok: true, slug, job_id: newJob.id }, 200);
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

    const slug = item.slug;
    if (!slug) throw new Error("Missing required field: slug (Site Slug column blank/invalid)");

    const title = safeString(item.title) || slug;
    const description = safeString(item.description) || ""; // NOT NULL
    const niche = safeString(item.niche) || ""; // NOT NULL

    const multiText = safeString(item.source_links_multi_text);
    const singleUrl = safeString(item.source_link_url);
    const singleText = safeString(item.source_link_text);

    const source_links_text = multiText || singleUrl || singleText || "";

    await logEvent(supabase, "INTAKE_RECEIVED", {
      mode: "monday",
      raw_slug: item.raw_slug,
      slug,
      niche,
      title,
      description,
      monday_item_id: item.monday_item_id,
      source_links_text,
    }, slug);

    // site upsert
    await withSchemaRetry(supabase, async () => {
      const { error } = await supabase.from("sites").upsert({
        slug,
        title,
        description,
        niche,
        status: "queued",
        source_links_text,
        monday_item_id: item.monday_item_id,
        intake_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "slug" });
      if (error) throw new Error(`site upsert failed: ${error.message}`);
      return true;
    });

    await logEvent(supabase, "SITE_UPSERTED", { slug }, slug);

    // products upsert (multi preferred, fallback single)
    const links = multiText ? splitUrls(multiText) : splitUrls(singleUrl || singleText);
    if (links.length) {
      const products = links.map((u, i) => ({
        site_slug: slug,
        rank: i + 1,
        title: fallbackTitleFromUrl(u),
        source_url: u,
        affiliate_url: u, // REQUIRED (NOT NULL)
        url: u,
        price_text: null,
        image_url: null,
      }));

      await withSchemaRetry(supabase, async () => {
        const { error } = await supabase.from("products").upsert(products, { onConflict: "site_slug,rank" });
        if (error) throw new Error(`products upsert failed: ${error.message}`);
        return true;
      });

      await logEvent(supabase, "PRODUCTS_UPSERTED", { slug, count: products.length }, slug);
    } else {
      await logEvent(supabase, "PRODUCTS_SKIPPED", { slug, reason: "no valid urls" }, slug);
    }

    // queue job (avoid duplicates)
    const { data: existingJob } = await supabase
      .from("jobs")
      .select("id,status")
      .eq("site_slug", slug)
      .eq("type", "GENERATE_SITE")
      .in("status", ["queued", "running", "retrying"])
      .maybeSingle();

    if (existingJob?.id) {
      await logEvent(supabase, "JOB_ALREADY_EXISTS", { slug, job_id: existingJob.id }, slug, existingJob.id);
      try {
        await mondaySetSystemStatus(MONDAY_API_TOKEN, itemId, "Queued");
      } catch {
        // ignore
      }
      return json({ ok: true, slug, job_id: existingJob.id, message: "job already queued/running" }, 200);
    }

    const { data: newJob, error: jobErr } = await supabase.from("jobs").insert({
      site_slug: slug,
      type: "GENERATE_SITE",
      status: "queued",
      attempts: 0,
      next_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("id").single();

    if (jobErr) throw new Error(`job insert failed: ${jobErr.message}`);

    try {
      await mondaySetSystemStatus(MONDAY_API_TOKEN, itemId, "Queued");
    } catch {
      // ignore
    }

    return json({ ok: true, slug, monday_item_id: item.monday_item_id, job_id: newJob.id }, 200);
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

