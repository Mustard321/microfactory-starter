/// <reference lib="deno.ns" />

import { getServiceClient } from "../_shared/supabase_client.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async () => {
  try {
    const supabase = getServiceClient();
    const nowIso = new Date().toISOString();

    const { count: runnableCount, error: runnableErr } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "retrying"])
      .lte("next_run_at", nowIso);

    if (runnableErr) return json({ ok: false, error: { code: "jobs_count_failed" } }, 500);

    const { data: lastSucceeded, error: lastSucceededErr } = await supabase
      .from("jobs")
      .select("run_finished_at")
      .eq("status", "succeeded")
      .order("run_finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSucceededErr) return json({ ok: false, error: { code: "last_succeeded_failed" } }, 500);

    const { data: lastFailed, error: lastFailedErr } = await supabase
      .from("jobs")
      .select("run_finished_at")
      .eq("status", "failed")
      .order("run_finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastFailedErr) return json({ ok: false, error: { code: "last_failed_failed" } }, 500);

    const { data: lastSite, error: lastSiteErr } = await supabase
      .from("sites")
      .select("generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSiteErr) return json({ ok: false, error: { code: "last_site_failed" } }, 500);

    return json({
      ok: true,
      now: nowIso,
      runnable_jobs_count: runnableCount ?? 0,
      last_job_succeeded_at: lastSucceeded?.run_finished_at ?? null,
      last_job_failed_at: lastFailed?.run_finished_at ?? null,
      last_site_generated_at: lastSite?.generated_at ?? null,
    });
  } catch {
    return json({ ok: false, error: { code: "internal_error" } }, 500);
  }
});
