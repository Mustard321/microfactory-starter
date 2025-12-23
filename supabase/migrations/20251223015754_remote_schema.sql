


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "site_slug" "text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "run_started_at" timestamp with time zone,
    "run_finished_at" timestamp with time zone,
    "lease_until" timestamp with time zone
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_job"("p_locked_by" "text", "p_lease_seconds" integer) RETURNS SETOF "public"."jobs"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_job public.jobs%rowtype;
begin
  select *
  into v_job
  from public.jobs
  where status in ('queued','retrying')
    and next_run_at <= now()
    and (lease_until is null or lease_until < now())
  order by next_run_at asc
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.jobs
  set status = 'running',
      locked_by = p_locked_by,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      run_started_at = coalesce(run_started_at, now()),
      updated_at = now()
  where id = v_job.id;

  return query
  select *
  from public.jobs
  where id = v_job.id;
end;
$$;


ALTER FUNCTION "public"."claim_next_job"("p_locked_by" "text", "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_job_failed"("p_job_id" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.jobs
  set
    status = 'failed',
    last_error = left(coalesce(p_error,''), 4000),
    run_finished_at = now(),
    locked_at = null,
    locked_by = null,
    updated_at = now()
  where id = p_job_id;
end;
$$;


ALTER FUNCTION "public"."mark_job_failed"("p_job_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_job_succeeded"("p_job_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.jobs
  set
    status = 'succeeded',
    last_error = null,
    run_finished_at = now(),
    locked_at = null,
    locked_by = null,
    updated_at = now()
  where id = p_job_id;
end;
$$;


ALTER FUNCTION "public"."mark_job_succeeded"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."schedule_job_retry"("p_job_id" "uuid", "p_error" "text", "p_base_seconds" integer DEFAULT 10, "p_max_backoff_seconds" integer DEFAULT 1800, "p_jitter_seconds" integer DEFAULT 10) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_attempts int;
  v_backoff int;
  v_jitter int;
begin
  select attempts into v_attempts from public.jobs where id = p_job_id;

  v_backoff := least(p_max_backoff_seconds, p_base_seconds * (2 ^ greatest(v_attempts - 1, 0)));
  v_jitter := floor(random() * p_jitter_seconds);

  update public.jobs
  set
    status = 'retrying',
    last_error = left(coalesce(p_error,''), 4000),
    next_run_at = now() + make_interval(secs => (v_backoff + v_jitter)),
    locked_at = null,
    locked_by = null,
    updated_at = now()
  where id = p_job_id;
end;
$$;


ALTER FUNCTION "public"."schedule_job_retry"("p_job_id" "uuid", "p_error" "text", "p_base_seconds" integer, "p_max_backoff_seconds" integer, "p_jitter_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_slug_hits" (
    "table_name" "text",
    "column_name" "text",
    "hit" "text"
);


ALTER TABLE "public"."_slug_hits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "base_domain" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."affiliate_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_type" "text" DEFAULT 'domain'::"text" NOT NULL,
    "match_value" "text" NOT NULL,
    "program_code" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."affiliate_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_type" "text" NOT NULL,
    "site_slug" "text",
    "job_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_slug" "text" NOT NULL,
    "page_slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "html_storage_path" "text",
    "published_url" "text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."placements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "seed_id" "uuid" NOT NULL,
    "site_slug" "text" NOT NULL,
    "rank" integer DEFAULT 1 NOT NULL,
    "affiliate_url" "text" NOT NULL,
    "program_code" "text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_seed_id" "uuid"
);


ALTER TABLE "public"."placements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_seeds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_url" "text" NOT NULL,
    "source_domain" "text" NOT NULL,
    "title" "text",
    "notes" "text",
    "niche" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text",
    "price_text" "text",
    "affiliate_url" "text"
);


ALTER TABLE "public"."product_seeds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_slug" "text" NOT NULL,
    "rank" integer DEFAULT 0 NOT NULL,
    "title" "text" NOT NULL,
    "price_text" "text",
    "source_url" "text",
    "affiliate_url" "text" NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "url" "text"
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_targets" (
    "slug" "text" NOT NULL,
    "niche" "text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."site_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "niche" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monday_item_id" bigint,
    "source_links_text" "text",
    "intake_updated_at" timestamp with time zone DEFAULT "now"(),
    "storage_bucket" "text",
    "storage_path" "text",
    "published_url" "text",
    "generated_at" timestamp with time zone
);


ALTER TABLE "public"."sites" OWNER TO "postgres";


ALTER TABLE ONLY "public"."affiliate_programs"
    ADD CONSTRAINT "affiliate_programs_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."affiliate_programs"
    ADD CONSTRAINT "affiliate_programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_rules"
    ADD CONSTRAINT "affiliate_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."placements"
    ADD CONSTRAINT "placements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_seeds"
    ADD CONSTRAINT "product_seeds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_site_slug_rank_unique" UNIQUE ("site_slug", "rank");



ALTER TABLE ONLY "public"."site_targets"
    ADD CONSTRAINT "site_targets_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_slug_key" UNIQUE ("slug");



CREATE INDEX "affiliate_rules_match_idx" ON "public"."affiliate_rules" USING "btree" ("match_type", "match_value");



CREATE INDEX "idx_jobs_runnable" ON "public"."jobs" USING "btree" ("status", "next_run_at") WHERE ("status" = ANY (ARRAY['queued'::"text", 'retrying'::"text"]));



CREATE INDEX "idx_jobs_status_next" ON "public"."jobs" USING "btree" ("status", "next_run_at");



CREATE INDEX "idx_products_site_rank" ON "public"."products" USING "btree" ("site_slug", "rank");



CREATE INDEX "idx_sites_status" ON "public"."sites" USING "btree" ("status");



CREATE INDEX "idx_sites_updated_at" ON "public"."sites" USING "btree" ("updated_at");



CREATE INDEX "jobs_lease_idx" ON "public"."jobs" USING "btree" ("lease_until");



CREATE UNIQUE INDEX "jobs_one_active_per_site_type" ON "public"."jobs" USING "btree" ("site_slug", "type") WHERE ("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'retrying'::"text"]));



CREATE INDEX "jobs_runnable_idx" ON "public"."jobs" USING "btree" ("status", "next_run_at") WHERE ("status" = ANY (ARRAY['queued'::"text", 'retrying'::"text"]));



CREATE UNIQUE INDEX "pages_unique" ON "public"."pages" USING "btree" ("site_slug", "page_slug");



CREATE INDEX "placements_site_status_idx" ON "public"."placements" USING "btree" ("site_slug", "status");



CREATE UNIQUE INDEX "placements_unique_site_seed" ON "public"."placements" USING "btree" ("site_slug", "seed_id");



CREATE UNIQUE INDEX "product_seeds_source_url_uq" ON "public"."product_seeds" USING "btree" ("source_url");



CREATE INDEX "site_targets_niche_idx" ON "public"."site_targets" USING "btree" ("niche", "is_active");



CREATE INDEX "sites_monday_item_id_idx" ON "public"."sites" USING "btree" ("monday_item_id");



CREATE OR REPLACE TRIGGER "trg_jobs_updated_at" BEFORE UPDATE ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sites_updated_at" BEFORE UPDATE ON "public"."sites" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."affiliate_rules"
    ADD CONSTRAINT "affiliate_rules_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "public"."affiliate_programs"("code");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_site_slug_fkey" FOREIGN KEY ("site_slug") REFERENCES "public"."sites"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_site_slug_fkey" FOREIGN KEY ("site_slug") REFERENCES "public"."site_targets"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."placements"
    ADD CONSTRAINT "placements_product_seed_id_fkey" FOREIGN KEY ("product_seed_id") REFERENCES "public"."product_seeds"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."placements"
    ADD CONSTRAINT "placements_program_code_fkey" FOREIGN KEY ("program_code") REFERENCES "public"."affiliate_programs"("code");



ALTER TABLE ONLY "public"."placements"
    ADD CONSTRAINT "placements_seed_id_fkey" FOREIGN KEY ("seed_id") REFERENCES "public"."product_seeds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."placements"
    ADD CONSTRAINT "placements_site_slug_fkey" FOREIGN KEY ("site_slug") REFERENCES "public"."site_targets"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_site_slug_fkey" FOREIGN KEY ("site_slug") REFERENCES "public"."sites"("slug") ON DELETE CASCADE;



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "no_public_events" ON "public"."events" FOR SELECT TO "anon" USING (false);



CREATE POLICY "no_public_jobs" ON "public"."jobs" FOR SELECT TO "anon" USING (false);



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_products" ON "public"."products" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "s"
  WHERE (("s"."slug" = "products"."site_slug") AND ("s"."status" = ANY (ARRAY['generated'::"text", 'deployed'::"text"]))))));



CREATE POLICY "public_read_sites" ON "public"."sites" FOR SELECT TO "anon" USING (("status" = ANY (ARRAY['generated'::"text", 'deployed'::"text"])));



ALTER TABLE "public"."sites" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_job"("p_locked_by" "text", "p_lease_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_locked_by" "text", "p_lease_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_locked_by" "text", "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_job_failed"("p_job_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_job_failed"("p_job_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_job_failed"("p_job_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_job_succeeded"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_job_succeeded"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_job_succeeded"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."schedule_job_retry"("p_job_id" "uuid", "p_error" "text", "p_base_seconds" integer, "p_max_backoff_seconds" integer, "p_jitter_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."schedule_job_retry"("p_job_id" "uuid", "p_error" "text", "p_base_seconds" integer, "p_max_backoff_seconds" integer, "p_jitter_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."schedule_job_retry"("p_job_id" "uuid", "p_error" "text", "p_base_seconds" integer, "p_max_backoff_seconds" integer, "p_jitter_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."_slug_hits" TO "anon";
GRANT ALL ON TABLE "public"."_slug_hits" TO "authenticated";
GRANT ALL ON TABLE "public"."_slug_hits" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_programs" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_programs" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_rules" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_rules" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON TABLE "public"."placements" TO "anon";
GRANT ALL ON TABLE "public"."placements" TO "authenticated";
GRANT ALL ON TABLE "public"."placements" TO "service_role";



GRANT ALL ON TABLE "public"."product_seeds" TO "anon";
GRANT ALL ON TABLE "public"."product_seeds" TO "authenticated";
GRANT ALL ON TABLE "public"."product_seeds" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."site_targets" TO "anon";
GRANT ALL ON TABLE "public"."site_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."site_targets" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


