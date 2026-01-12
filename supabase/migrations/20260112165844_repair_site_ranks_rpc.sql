create or replace function public.repair_site_ranks(
  p_site_slug text
)
returns int
language sql
volatile
as $$
  with ordered as (
    select
      id,
      row_number() over (
        order by rank asc nulls last, created_at asc, id asc
      ) as new_rank
    from public.placements
    where site_slug = p_site_slug
  ),
  updated as (
    update public.placements p
    set rank = o.new_rank
    from ordered o
    where p.id = o.id
    returning 1
  )
  select count(*)::int from updated;
$$;
