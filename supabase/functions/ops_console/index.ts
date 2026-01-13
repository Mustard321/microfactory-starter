/// <reference lib="deno.ns" />

import { getServiceClient } from "../_shared/supabase_client.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function esc(s: string): string {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function iso(d: Date): string {
  return d.toISOString();
}

function isoMinusMinutes(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

function isoMinusHours(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function isoMinusDays(d: number): string {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

function isoStartOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n <= 3) return s.slice(0, n);
  return `${s.slice(0, n - 3)}...`;
}

Deno.serve(async (req) => {
  const OPS_SECRET = Deno.env.get("OPS_SECRET") || "";
  const got = req.headers.get("x-ops-secret") || "";
  if (!OPS_SECRET) return json({ ok: false, error: "Missing OPS_SECRET in env" }, 500);
  if (!got) return json({ ok: false, error: "missing x-ops-secret header" }, 401);
  if (got !== OPS_SECRET) return json({ ok: false, error: "invalid x-ops-secret header" }, 401);

  const supabase = getServiceClient();
  const nowIso = iso(new Date());

  const cutoff60m = isoMinusMinutes(60);
  const cutoff10m = isoMinusMinutes(10);
  const cutoff24h = isoMinusHours(24);
  const cutoff7d = isoMinusDays(7);
  const todayStart = isoStartOfUtcDay();

  const { data: latestTick } = await supabase
    .from("events")
    .select("at,payload")
    .eq("event_type", "CRON_TICK")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: ticksLast60 } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "CRON_TICK")
    .gte("at", cutoff60m);

  const latestTickAt = latestTick?.at ? String(latestTick.at) : "";
  const cronOk = latestTickAt && latestTickAt >= cutoff10m;

  const jobStatuses = ["queued", "running", "retrying", "succeeded", "failed"] as const;
  const jobCounts: Record<string, number> = {};
  for (const status of jobStatuses) {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", status)
      .gte("updated_at", cutoff24h);
    jobCounts[status] = count ?? 0;
  }
  const backlog = (jobCounts.queued || 0) + (jobCounts.retrying || 0);

  const { data: failedJobs } = await supabase
    .from("jobs")
    .select("id,site_slug,last_error,run_finished_at")
    .eq("status", "failed")
    .order("run_finished_at", { ascending: false })
    .limit(10);

  const { count: queuedTotal } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "JOB_QUEUED")
    .gte("at", cutoff24h);

  const { count: queuedManual } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "JOB_QUEUED")
    .eq("payload->>mode", "manual")
    .gte("at", cutoff24h);

  const { count: queuedMonday } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "JOB_QUEUED")
    .eq("payload->>mode", "monday")
    .gte("at", cutoff24h);

  const queuedUnknown =
    (queuedTotal ?? 0) - (queuedManual ?? 0) - (queuedMonday ?? 0);

  const { count: generatedCount } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "SITE_GENERATED")
    .gte("at", cutoff24h);

  const { data: generatedSites } = await supabase
    .from("events")
    .select("site_slug,at")
    .eq("event_type", "SITE_GENERATED")
    .order("at", { ascending: false })
    .limit(10);

  const { count: clicks24 } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "CLICK")
    .gte("at", cutoff24h);

  const { count: clicks7d } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "CLICK")
    .gte("at", cutoff7d);

  const { count: skipped24 } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "CLICK_SKIPPED")
    .gte("at", cutoff24h);

  const { data: pinEvents } = await supabase
    .from("events")
    .select("event_type,payload")
    .in("event_type", ["PIN_PUBLISHED", "PIN_FAILED"])
    .gte("at", cutoff24h);

  let pinsPublished24 = 0;
  let pinsFailed24 = 0;
  const pinsByNiche: Record<string, number> = {};
  for (const row of pinEvents || []) {
    const ev = row as any;
    if (ev.event_type === "PIN_PUBLISHED") {
      pinsPublished24 += 1;
      const niche = String(ev.payload?.niche || "unknown");
      pinsByNiche[niche] = (pinsByNiche[niche] || 0) + 1;
    } else if (ev.event_type === "PIN_FAILED") {
      pinsFailed24 += 1;
    }
  }

  const { data: siteRows } = await supabase
    .from("sites")
    .select("slug")
    .order("updated_at", { ascending: false })
    .limit(50);

  const topClicks: Array<{
    placement_id: string;
    clicks: number;
    site_slug: string;
  }> = [];

  if (siteRows?.length) {
    const perSite = await Promise.all(
      siteRows.map(async (row: any) => {
        const slug = String(row.slug || "");
        if (!slug) return [];
        const { data } = await supabase.rpc("most_clicked_placements", {
          p_site_slug: slug,
          p_days: 7,
          p_limit: 50,
        });
        return (data || []).map((r: any) => ({
          placement_id: String(r.placement_id || ""),
          clicks: Number(r.clicks || 0),
          site_slug: slug,
        }));
      }),
    );

    const merged: Array<{ placement_id: string; clicks: number; site_slug: string }> = [];
    for (const list of perSite) {
      for (const row of list) {
        if (!row.placement_id) continue;
        merged.push(row);
      }
    }

    merged.sort((a, b) => b.clicks - a.clicks);
    topClicks.push(...merged.slice(0, 10));
  }

  const { count: placementsToday } = await supabase
    .from("placements")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart);

  const { count: sitesGeneratedToday } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "SITE_GENERATED")
    .gte("at", todayStart);

  const lines: string[] = [];
  lines.push(`MICROFACTORY OPS CONSOLE (UTC) ${nowIso}`);
  lines.push("");

  lines.push("CRON");
  lines.push(`latest: ${latestTickAt || "none"}`);
  lines.push(`ticks_last_60m: ${ticksLast60 ?? 0}`);
  lines.push(`status: ${cronOk ? "OK" : "FAIL"}`);
  lines.push("");

  lines.push("JOBS (24h)");
  lines.push(`queued: ${jobCounts.queued || 0}`);
  lines.push(`running: ${jobCounts.running || 0}`);
  lines.push(`retrying: ${jobCounts.retrying || 0}`);
  lines.push(`succeeded: ${jobCounts.succeeded || 0}`);
  lines.push(`failed: ${jobCounts.failed || 0}`);
  lines.push(`backlog: ${backlog}`);
  lines.push("last_failed:");
  if (failedJobs?.length) {
    for (const j of failedJobs) {
      const err = trunc(String(j.last_error || ""), 120);
      const finished = j.run_finished_at ? String(j.run_finished_at) : "";
      lines.push(`- ${j.id} | ${j.site_slug || ""} | ${finished} | ${err}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("INGEST (24h)");
  lines.push(`job_queued_total: ${queuedTotal ?? 0}`);
  lines.push(`job_queued_manual: ${queuedManual ?? 0}`);
  lines.push(`job_queued_monday: ${queuedMonday ?? 0}`);
  lines.push(`job_queued_unknown: ${queuedUnknown}`);
  lines.push("");

  lines.push("GENERATION (24h)");
  lines.push(`site_generated_count: ${generatedCount ?? 0}`);
  lines.push("recent_generated:");
  if (generatedSites?.length) {
    for (const g of generatedSites) {
      lines.push(`- ${g.site_slug || ""} | ${g.at || ""}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("CLICKS");
  lines.push(`clicks_24h: ${clicks24 ?? 0}`);
  lines.push(`clicks_7d: ${clicks7d ?? 0}`);
  lines.push(`click_skipped_24h: ${skipped24 ?? 0}`);
  lines.push("top_placements_7d:");
  if (topClicks.length) {
    for (const row of topClicks) {
      lines.push(`- ${row.placement_id} | ${row.site_slug} | ${row.clicks}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("PINTEREST (24h)");
  lines.push(`pins_published_24h: ${pinsPublished24}`);
  lines.push(`pins_failed_24h: ${pinsFailed24}`);
  lines.push("pins_by_niche:");
  const nicheKeys = Object.keys(pinsByNiche);
  if (nicheKeys.length) {
    for (const k of nicheKeys.sort()) {
      lines.push(`- ${k}: ${pinsByNiche[k]}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("OUTPUT TODAY");
  lines.push(`placements_created_today: ${placementsToday ?? 0}`);
  lines.push(`sites_generated_today: ${sitesGeneratedToday ?? 0}`);
  lines.push(`goal_progress: ${sitesGeneratedToday ?? 0}/7`);

  const body = `<pre>${esc(lines.join("\n"))}</pre>`;
  return html(body, 200);
});
