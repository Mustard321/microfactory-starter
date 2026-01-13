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

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(v);
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const THROTTLE_WINDOW_SECONDS = 60;
const THROTTLE_MAX_CLICKS = 6;

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const placementId = (url.searchParams.get("p") || "").trim();
    if (!placementId) {
      return json({ ok: false, error: { code: "missing_placement_id" } }, 400);
    }
    if (!isUuid(placementId)) {
      return json({ ok: false, error: { code: "invalid_placement_id" } }, 400);
    }

    const supabase = getServiceClient();

    const { data: placement, error: plcErr } = await supabase
      .from("placements")
      .select("id,affiliate_url,site_slug,seed_id")
      .eq("id", placementId)
      .maybeSingle();

    if (plcErr) return json({ ok: false, error: { code: "placement_lookup_failed" } }, 500);
    if (!placement) return json({ ok: false, error: { code: "placement_not_found" } }, 404);

    const affiliateUrl = String(placement.affiliate_url || "");
    if (!affiliateUrl) return json({ ok: false, error: { code: "missing_affiliate_url" } }, 404);
    if (!isHttpUrl(affiliateUrl)) {
      return json({ ok: false, error: { code: "invalid_affiliate_url" } }, 400);
    }

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

    let skipClick = false;
    if (ipHint && ua) {
      const cutoffIso = new Date(Date.now() - THROTTLE_WINDOW_SECONDS * 1000).toISOString();
      const { count, error: throttleErr } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "CLICK")
        .eq("payload->>placement_id", placementId)
        .eq("payload->>ip_hint", ipHint)
        .eq("payload->>ua", ua)
        .gte("at", cutoffIso);

      if (!throttleErr && (count ?? 0) > THROTTLE_MAX_CLICKS) {
        skipClick = true;
      }
    }

    if (skipClick) {
      try {
        await supabase.from("events").insert({
          event_type: "CLICK_SKIPPED",
          payload: {
            ...payload,
            reason: "throttled",
            window_seconds: THROTTLE_WINDOW_SECONDS,
            max_clicks: THROTTLE_MAX_CLICKS,
          },
          site_slug: placement.site_slug || null,
          job_id: null,
        });
      } catch {
        // ignore
      }
    } else {
      const { error: evtErr } = await supabase.from("events").insert({
        event_type: "CLICK",
        payload,
        site_slug: placement.site_slug || null,
        job_id: null,
      });

      if (evtErr) {
        console.error("click event insert failed", evtErr.message);
      }
    }

    return redirect(affiliateUrl);
  } catch (e) {
    return json({ ok: false, error: { code: "internal_error" } }, 500);
  }
});
