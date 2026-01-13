/// <reference lib="deno.ns" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ---------------------------------- utils --------------------------------- */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n <= 3) return s.slice(0, n);
  return `${s.slice(0, n - 3)}...`;
}

/* --------------------------------- config --------------------------------- */
const MONDAY_BOARD_ID = 18392861068;
const COL_APPROVAL = "color_mkyvzaeq";
const APPROVED_INDEX = 1;

const COL_SLUG = "text_mkyvmaza";
const COL_TITLE = "text_mkyvs741";
const COL_DESC = "long_text_mkyvrh7p";
const COL_NICHE = "dropdown_mkyvggbk";
const COL_SOURCE_LINK = "link_mkyv2h27";
const COL_SOURCE_LINKS_MULTI = "long_text_mkywmd1v";
const COL_SYSTEM_STATUS = "color_mkyvf3nn";

/* ---------------------------- monday helpers ------------------------------- */
function parseApprovalIndex(value: any): number | null {
  try {
    if (!value) return null;
    if (typeof value === "string") {
      const v = JSON.parse(value);
      return v?.index ?? v?.label?.index ?? null;
    }
    return value?.index ?? value?.label?.index ?? null;
  } catch {
    return null;
  }
}

async function mondayGraphQL(token: string, query: string, variables?: any) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token.trim()}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Monday ${res.status}: ${text}`);

  const parsed = JSON.parse(text);
  if (parsed.errors?.length) {
    throw new Error(JSON.stringify(parsed.errors));
  }
  return parsed;
}

async function mondaySetStatus(token: string, itemId: number, label: string) {
  const mutation = `
    mutation ($itemId: ID!, $boardId: ID!, $col: String!, $val: JSON!) {
      change_column_value(item_id: $itemId, board_id: $boardId, column_id: $col, value: $val) { id }
    }
  `;
  await mondayGraphQL(token, mutation, {
    itemId,
    boardId: MONDAY_BOARD_ID,
    col: COL_SYSTEM_STATUS,
    val: JSON.stringify({ label }),
  });
}

async function mondaySetText(token: string, itemId: number, columnId: string, text: string) {
  const mutation = `
    mutation ($itemId: ID!, $boardId: ID!, $col: String!, $val: JSON!) {
      change_column_value(item_id: $itemId, board_id: $boardId, column_id: $col, value: $val) { id }
    }
  `;
  await mondayGraphQL(token, mutation, {
    itemId,
    boardId: MONDAY_BOARD_ID,
    col: columnId,
    val: JSON.stringify({ text }),
  });
}

function bestEffort(p: Promise<unknown>) {
  return p.catch(() => undefined);
}

function extractItemId(event: any, body: any): number | null {
  const candidates = [
    event?.pulseId,
    event?.itemId,
    event?.item_id,
    event?.pulse_id,
    body?.pulseId,
    body?.itemId,
    body?.item_id,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim()) {
      const n = Number(c.trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/* ------------------------------- supabase ---------------------------------- */
async function logEvent(
  supabase: any,
  type: string,
  payload: any,
  site_slug?: string,
  job_id?: string,
) {
  try {
    await supabase.from("events").insert({
      event_type: type,
      payload,
      site_slug: site_slug ?? null,
      job_id: job_id ?? null,
    });
  } catch {
    // ignore
  }
}

async function logIntakeFailed(
  supabase: any,
  itemId: number | null,
  siteSlug: string | null,
  niche: string | null,
  urlsCount: number | null,
  error: string,
) {
  await logEvent(
    supabase,
    "INTAKE_FAILED",
    {
      monday_item_id: itemId,
      item_id: itemId,
      slug: siteSlug,
      site_slug_if_any: siteSlug,
      niche,
      extracted_urls_count: urlsCount,
      error,
    },
    siteSlug ?? undefined,
    undefined,
  );
}

function extractMondayLink(value: any): { url?: string; text?: string } {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return { url: parsed?.url, text: parsed?.text };
    } catch {
      return { text: value };
    }
  }
  return { url: value?.url, text: value?.text };
}

function extractSourceUrls(cols: Record<string, any>): string[] {
  const multi = safeString(cols[COL_SOURCE_LINKS_MULTI]?.text || "");
  if (multi) return splitUrls(multi);

  const linkVal = extractMondayLink(cols[COL_SOURCE_LINK]?.value);
  const linkUrl = safeString(linkVal.url || "");
  const linkText = safeString(linkVal.text || "");
  const colText = safeString(cols[COL_SOURCE_LINK]?.text || "");

  const combined = [linkUrl, linkText, colText].filter(Boolean).join(" ");
  return combined ? splitUrls(combined) : [];
}

/* ------------------------- TARGET RESOLUTION (A) ---------------------------- */
async function resolveTargetSiteSlug(
  supabase: any,
  niche: string,
): Promise<string> {
  const clean = safeString(niche) || "default";

  const { data, error } = await supabase
    .rpc("resolve_target_site_slug", {
      p_niche: clean,
      p_cap: 20,
    })
    .single();

  if (error) {
    await logEvent(supabase, "TARGET_RESOLVE_RPC_FAILED", {
      niche: clean,
      error: error.message,
    });
    throw error;
  }

  const slug = safeString((data as any)?.site_slug);
  if (!slug) throw new Error("RPC returned empty site_slug");
  return slug;
}

/* --------------------------- job + legacy writes --------------------------- */
async function ensureSiteRow(
  supabase: any,
  slug: string,
  title: string,
  niche: string,
) {
  const payload = {
    slug,
    title: safeString(title) || slug,
    description: safeString(title)
      ? `Curated picks for ${safeString(title)}`
      : `Curated picks for ${slug}`,
    niche: safeString(niche) || "default",
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("sites").upsert(payload, {
    onConflict: "slug",
  });

  if (error) throw error;
}

async function queueGenerateJob(supabase: any, site_slug: string) {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("site_slug", site_slug)
    .eq("type", "GENERATE_SITE")
    .in("status", ["queued", "running"])
    .maybeSingle();

  if (data?.id) return data.id;

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      site_slug,
      type: "GENERATE_SITE",
      status: "queued",
      attempts: 0,
      next_run_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return job.id;
}

async function upsertSeedsAndPlacements(
  supabase: any,
  niche: string,
  urls: string[],
  site_slug: string,
) {
  if (!urls.length) return;

  const { data: maxRow } = await supabase
    .from("placements")
    .select("rank")
    .eq("site_slug", site_slug)
    .order("rank", { ascending: false })
    .limit(1)
    .maybeSingle();

  let rank = Number((maxRow as any)?.rank || 0);

  for (const url of urls) {
    const domain = domainFromUrl(url);
    if (!domain) continue;

    const { data: seed } = await supabase
      .from("product_seeds")
      .upsert(
        {
          source_url: url,
          source_domain: domain,
          niche,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_url" },
      )
      .select("id")
      .single();

    rank++;

    await supabase.from("placements").upsert(
      {
        seed_id: seed.id,
        site_slug,
        rank,
        affiliate_url: url,
        status: "queued",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "site_slug,seed_id" },
    );
  }
}

/* --------------------------------- handler -------------------------------- */
Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MONDAY_API_TOKEN = Deno.env.get("MONDAY_API_TOKEN")!;
  const MONDAY_WEBHOOK_TOKEN = Deno.env.get("MONDAY_WEBHOOK_TOKEN")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  /* handshake */
  const raw = await req.clone().json().catch(() => null);
  if ((raw as any)?.challenge) {
    return json({ challenge: (raw as any).challenge });
  }

  /* token gate */
  const token = new URL(req.url).searchParams.get("token");
  if (token !== MONDAY_WEBHOOK_TOKEN) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false }, 400);

  /* ---------------------------- MANUAL MODE ---------------------------- */
  if (!(body as any).event) {
    try {
      const title = safeString(body.title) || "untitled";
      const niche = safeString(body.niche) || "default";
      const urls = splitUrls(body.source_links_text || "");
      const siteSlug = await resolveTargetSiteSlug(supabase, niche);
      await upsertSeedsAndPlacements(supabase, niche, urls, siteSlug);
      await ensureSiteRow(supabase, siteSlug, title, niche);
      const jobId = await queueGenerateJob(supabase, siteSlug);

      await logEvent(
        supabase,
        "JOB_QUEUED",
        { site_slug: siteSlug, job_id: jobId, mode: "manual" },
        siteSlug,
        jobId,
      );

      return json({ ok: true, site: siteSlug, job_id: jobId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logIntakeFailed(supabase, null, null, null, null, msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  /* ---------------------------- MONDAY MODE ----------------------------- */
  const event = (body as any).event;

  if (event.boardId !== MONDAY_BOARD_ID || event.columnId !== COL_APPROVAL) {
    return json({ ok: true, ignored: true });
  }

  const current = parseApprovalIndex(event.value);
  const previous = parseApprovalIndex(event.previousValue);

  // ✅ PREVENT RE-TRIGGERS
  if (current !== APPROVED_INDEX || previous === APPROVED_INDEX) {
    return json({ ok: true, ignored: "not newly approved" });
  }

  const itemId = extractItemId(event, body);
  if (!itemId) {
    await logIntakeFailed(supabase, null, null, null, null, "missing item id");
    return json({ ok: false, error: "missing item id" }, 400);
  }

  await bestEffort(mondaySetStatus(MONDAY_API_TOKEN, itemId, "Processing"));

  let siteSlug: string | null = null;
  let nicheValue = "default";
  let urlsCount = 0;
  try {
    const query = `
      query ($id:[ID!]) {
        items(ids:$id) {
          id name
          column_values { id text value }
        }
      }
    `;
    const res = await mondayGraphQL(MONDAY_API_TOKEN, query, { id: [String(itemId)] });
    const item = res.data.items[0];

    const cols: Record<string, any> = {};
    for (const c of item.column_values) cols[c.id] = c;

    const title = safeString(cols[COL_TITLE]?.text || item.name);
    const niche = safeString(cols[COL_NICHE]?.text) || "default";
    const urls = extractSourceUrls(cols);
    nicheValue = niche;
    urlsCount = urls.length;
    siteSlug = await resolveTargetSiteSlug(supabase, niche);

    await upsertSeedsAndPlacements(supabase, niche, urls, siteSlug);
    await ensureSiteRow(supabase, siteSlug, title, niche);
    const jobId = await queueGenerateJob(supabase, siteSlug);

    await bestEffort(mondaySetText(MONDAY_API_TOKEN, itemId, COL_SLUG, siteSlug));
    await bestEffort(mondaySetStatus(MONDAY_API_TOKEN, itemId, "Queued"));
    await logEvent(
      supabase,
      "JOB_QUEUED",
      { site_slug: siteSlug, job_id: jobId, mode: "monday", item_id: itemId },
      siteSlug,
      jobId,
    );

    return json({ ok: true, site: siteSlug, job_id: jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await bestEffort(mondaySetStatus(MONDAY_API_TOKEN, itemId, "Failed"));
    await bestEffort(mondaySetText(MONDAY_API_TOKEN, itemId, COL_DESC, trunc(msg, 120)));
    await bestEffort(mondaySetText(MONDAY_API_TOKEN, itemId, COL_SLUG, siteSlug || ""));
    await logIntakeFailed(supabase, itemId, siteSlug, nicheValue, urlsCount, msg);
    return json({ ok: false, error: String(e) });
  }
});
