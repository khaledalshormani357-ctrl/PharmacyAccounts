-- Preserve email login compatibility while adding username login.
-- This resolver returns only the Auth user id and is callable only by service_role.
create or replace function public.resolve_username_login(p_username text)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, pharmacy_private, auth
as $$
  select candidate.user_id
  from (
    select u.id as user_id, 0 as priority
    from auth.users as u
    where lower(btrim(u.email)) = lower(btrim(p_username))
      and u.deleted_at is null

    union all

    select i.user_id, 1 as priority
    from pharmacy_private.auth_login_identifiers as i
    where lower(btrim(i.username)) = lower(btrim(p_username))
      and not exists (
        select 1
        from auth.users as u
        where lower(btrim(u.email)) = lower(btrim(p_username))
          and u.deleted_at is null
      )
  ) as candidate
  order by candidate.priority
  limit 2;
$$;

revoke all on function public.resolve_username_login(text) from public, anon, authenticated;
grant execute on function public.resolve_username_login(text) to service_role;
