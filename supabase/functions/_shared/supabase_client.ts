// supabase/functions/_shared/supabase_client.ts
/// <reference lib="deno.ns" />

// Re-export createClient so any function can import it consistently.
// This avoids "does not provide an export named createClient" boot errors.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export { createClient };

// (Optional) helper if you want a single standard constructor later.
// Leaving it here is harmless and sometimes convenient.
export function getServiceClientEnv() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}

export function getServiceClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getServiceClientEnv();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase service role env");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
