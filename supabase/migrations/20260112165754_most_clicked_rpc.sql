create or replace function public.most_clicked_placements(
  p_site_slug text,
  p_days int default 7,
  p_limit int default 20
)
returns table (
  placement_id uuid,
  clicks int,
  seed_id uuid,
  affiliate_url text,
  rank int
)
language sql
stable
as $$
  with click_counts as (
    select
      (payload->>'placement_id')::uuid as placement_id,
      count(*)::int as clicks
    from public.events
    where event_type = 'CLICK'
      and payload ? 'placement_id'
      and (payload->>'placement_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and "at" >= now() - make_interval(days => greatest(p_days, 0))
    group by (payload->>'placement_id')::uuid
  )
  select
    p.id as placement_id,
    c.clicks,
    p.seed_id,
    p.affiliate_url,
    p.rank
  from click_counts c
  join public.placements p on p.id = c.placement_id
  where p.site_slug = p_site_slug
  order by c.clicks desc, p.rank asc
  limit greatest(p_limit, 0);
$$;
