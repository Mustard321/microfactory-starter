// supabase/functions/_shared/supabase_client.ts
/// <reference lib="deno.ns" />

// Re-export createClient so any function can import it consistently.
// This avoids "does not provide an export named createClient" boot errors.
export { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// (Optional) helper if you want a single standard constructor later.
// Leaving it here is harmless and sometimes convenient.
export function getServiceClientEnv() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}
