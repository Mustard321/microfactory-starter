/// <reference lib="deno.ns" />

import { getServiceClient } from "../_shared/supabase_client.ts";

function text(body: string, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeSlug(s: string): string {
  const v = (s || "").trim().toLowerCase();
  if (!v) return "";
  if (!/^[a-z0-9-]+$/.test(v)) return "";
  return v;
}

function extractSlugFromPath(pathname: string): string {
  // Supports:
  // /site_public/<slug>
  // /<slug>   (if you later map routes)
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts[0] === "site_public") return parts[1] || "";
  return parts[0] || "";
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const slugRaw = extractSlugFromPath(url.pathname);
    const slug = safeSlug(slugRaw);
    if (!slug) return json({ ok: false, error: "Invalid slug" }, 400);

    const supabase = getServiceClient();

    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("storage_bucket, storage_path, status")
      .eq("slug", slug)
      .maybeSingle();

    if (siteErr) return json({ ok: false, error: siteErr.message }, 500);
    if (!site) return json({ ok: false, error: "Site not found" }, 404);

    const bucket = site.storage_bucket || "sites";
    const path = site.storage_path || `${slug}/index.html`;

    const { data, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !data) return json({ ok: false, error: dlErr?.message || "Download failed" }, 500);

    const html = await data.text();
    return text(html, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
