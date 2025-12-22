# MicroFactory Starter (Supabase + Monday + Static Microsites + Pinterest Pins)

**Goal:** A production-grade, idempotent pipeline that turns a submitted niche + source links into:
1) a generated microsite (static) and
2) a queued Pinterest pin
with full audit logging and retries.

## What this repo contains
- `apps/web` - Next.js microsite renderer (static export-ready)
- `packages/shared` - shared types + utilities
- `supabase/functions` - Edge Functions (webhook intake, job runner, pin queue)
- `ops/monday-board-schema.md` - suggested Monday board structure (text-only safe UI)
- `ops/security-safety.md` - safety constraints (no browsing, no images for Luke)
- `db/schema.sql` - tables for sites/products/jobs/events

## MVP flow (v1)
1. Wanda posts a TikTok URL + niche into a Monday form/item.
2. Monday automation calls `POST /functions/v1/intake_monday_webhook`.
3. Intake function writes a `site` + `job` row and logs an event.
4. A scheduled job runner picks up jobs:
   - resolves affiliate links (v1 = "passthrough / manual"; v2 = network APIs)
   - generates site content JSON
   - marks site as `generated`
5. CI build/deploy publishes the static site.
6. Pin queue job creates a Pinterest pin via Pinterest API **only for original content** (your generated pin image),
   or leaves a queued record for manual review if API access is not available.

## Important constraints
- **No TikTok feed scraping.** Wanda supplies URLs manually. TikTok API generally does **not** provide "read my For You feed".
- **Pinterest Create Pin** is intended for publishing content created by the user; do not repost others' pins verbatim.
- **Amazon PA-API** requires eligibility (10 qualified sales in trailing 30 days); start with manual affiliate links.

## Local quickstart
1. `cd apps/web && npm i && npm run dev`
2. Create Supabase project, run `db/schema.sql`
3. Copy `.env.example` to `.env` in:
   - `apps/web`
   - `supabase/functions`
4. Deploy Edge Functions (or run locally with Supabase CLI).

## Status
This is a **starter scaffold**. You will still need to:
- wire real Pinterest OAuth + pin creation
- choose an image generation vendor (or pre-made template assets)
- implement network-specific affiliate link creation

