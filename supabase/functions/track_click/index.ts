/// <reference lib="deno.ns" />

import { getServiceClient } from "../_shared/supabase_client.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function redirect(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function firstIpHint(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip") || "";
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for") || "";
  if (xff) return xff.split(",")[0].trim();
  const real = headers.get("x-real-ip") || "";
  return real.trim();
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const placementId = (url.searchParams.get("p") || "").trim();
    if (!placementId) return json({ ok: false, error: "Missing placement id" }, 400);

    const supabase = getServiceClient();

    const { data: placement, error: plcErr } = await supabase
      .from("placements")
      .select("id,affiliate_url,site_slug,seed_id")
      .eq("id", placementId)
      .maybeSingle();

    if (plcErr) return json({ ok: false, error: plcErr.message }, 500);
    if (!placement) return json({ ok: false, error: "Placement not found" }, 404);

    const affiliateUrl = String(placement.affiliate_url || "");
    if (!affiliateUrl) return json({ ok: false, error: "Missing affiliate_url" }, 404);

    const ua = req.headers.get("user-agent") || "";
    const referrer = req.headers.get("referer") || "";
    const ipHint = firstIpHint(req.headers);
    const timestamp = new Date().toISOString();

    const payload = {
      placement_id: placementId,
      site_slug: placement.site_slug || null,
      seed_id: placement.seed_id || null,
      ua,
      referrer,
      ip_hint: ipHint || null,
      timestamp,
    };

    const { error: evtErr } = await supabase.from("events").insert({
      event_type: "CLICK",
      payload,
      site_slug: placement.site_slug || null,
      job_id: null,
    });

    if (evtErr) {
      console.error("click event insert failed", evtErr.message);
    }

    return redirect(affiliateUrl);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
