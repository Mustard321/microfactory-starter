/// <reference lib="deno.ns" />

type WritebackSource = "intake" | "job_runner";

export type WritebackContext = {
  source: WritebackSource;
  monday_item_id: number | null;
  site_slug?: string | null;
  board_id: number;
  resolved?: Record<string, unknown>;
  intended?: Record<string, unknown>;
};

async function logEvent(
  supabase: any,
  event_type: string,
  payload: Record<string, unknown>,
  site_slug?: string | null,
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

export async function writebackAttempt(supabase: any, ctx: WritebackContext) {
  await logEvent(supabase, "MONDAY_WRITEBACK_ATTEMPT", ctx as any, ctx.site_slug);
}

export async function writebackSuccess(supabase: any, ctx: WritebackContext) {
  await logEvent(supabase, "MONDAY_WRITEBACK_SUCCESS", ctx as any, ctx.site_slug);
}

export async function writebackFailed(supabase: any, ctx: WritebackContext, error: string) {
  await logEvent(
    supabase,
    "MONDAY_WRITEBACK_FAILED",
    { ...(ctx as any), error },
    ctx.site_slug,
  );
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

export async function mondayChangeColumnValue(
  token: string,
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
  await mondayGraphQL(token, mutation, {
    itemId,
    boardId,
    colId: columnId,
    val,
  });
}

const boardCache = new Map<number, Record<string, string>>();

export async function mondayGetBoardColumns(token: string, boardId: number) {
  if (boardCache.has(boardId)) return boardCache.get(boardId)!;
  const query = `
    query ($id:[ID!]) {
      boards(ids: $id) {
        id
        columns { id title }
      }
    }
  `;
  const res = await mondayGraphQL(token, query, { id: [String(boardId)] });
  const cols = res?.data?.boards?.[0]?.columns || [];
  const byTitle: Record<string, string> = {};
  for (const c of cols) {
    const title = String(c?.title || "").trim().toLowerCase();
    if (title) byTitle[title] = String(c?.id || "");
  }
  boardCache.set(boardId, byTitle);
  return byTitle;
}

function resolveByTitles(
  map: Record<string, string>,
  titles: string[],
): { id?: string; title?: string } {
  for (const t of titles) {
    const key = String(t || "").trim().toLowerCase();
    if (key && map[key]) return { id: map[key], title: t };
  }
  return {};
}

export async function resolveColumnIdsByTitle(
  token: string,
  boardId: number,
  titles: {
    siteSlugTitle: string[];
    statusTitle: string[];
    publishedUrlTitle: string[];
  },
) {
  const map = await mondayGetBoardColumns(token, boardId);
  const siteSlug = resolveByTitles(map, titles.siteSlugTitle);
  const status = resolveByTitles(map, titles.statusTitle);
  const published = resolveByTitles(map, titles.publishedUrlTitle);
  return {
    siteSlugColId: siteSlug.id,
    siteSlugTitle: siteSlug.title,
    statusColId: status.id,
    statusTitle: status.title,
    publishedUrlColId: published.id,
    publishedUrlTitle: published.title,
    titles: Object.keys(map),
  };
}
