create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text not null,
  niche text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  site_slug text not null references sites(slug) on delete cascade,
  rank int not null default 0,
  title text not null,
  price_text text,
  source_url text,
  affiliate_url text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null default 'queued',
  site_slug text not null references sites(slug) on delete cascade,
  attempts int not null default 0,
  last_error text,
  next_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  event_type text not null,
  site_slug text,
  job_id uuid,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_jobs_status_next on jobs(status, next_run_at);
create index if not exists idx_products_site_rank on products(site_slug, rank);
