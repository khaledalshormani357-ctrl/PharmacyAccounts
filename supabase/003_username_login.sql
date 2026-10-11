-- Username sign-in support without exposing Auth emails to the mobile client.
-- Password verification remains with Supabase Auth.

create schema if not exists pharmacy_private;
revoke all on schema pharmacy_private from public, anon, authenticated;
grant usage on schema pharmacy_private to service_role;

create table if not exists pharmacy_private.auth_login_identifiers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  updated_at timestamptz not null default now()
);

alter table pharmacy_private.auth_login_identifiers enable row level security;
revoke all on table pharmacy_private.auth_login_identifiers from public, anon, authenticated;
grant select, insert, update, delete on table pharmacy_private.auth_login_identifiers to service_role;
create unique index if not exists auth_login_identifiers_username_ci_unique
  on pharmacy_private.auth_login_identifiers (lower(btrim(username)));

create or replace function public.sync_auth_login_identifier()
returns trigger
language plpgsql
security definer
set search_path = public, pharmacy_private, pg_temp
as $$
declare
  v_username text;
begin
  v_username := lower(btrim(coalesce(
    nullif(btrim(new.raw_user_meta_data->>'username'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  )));
  if v_username = '' then
    delete from pharmacy_private.auth_login_identifiers where user_id = new.id;
    return new;
  end if;

  insert into pharmacy_private.auth_login_identifiers (user_id, username, updated_at)
  values (new.id, v_username, now())
  on conflict (user_id) do update
    set username = excluded.username, updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.sync_auth_login_identifier() from public, anon, authenticated;
drop trigger if exists on_auth_user_login_identifier on auth.users;
create trigger on_auth_user_login_identifier
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_auth_login_identifier();

-- Backfill existing Auth users. Without explicit user_metadata.username, the
-- initial username is the email local part (characters before @).
insert into pharmacy_private.auth_login_identifiers (user_id, username, updated_at)
select
  u.id,
  lower(btrim(coalesce(nullif(btrim(u.raw_user_meta_data->>'username'), ''), split_part(u.email, '@', 1)))),
  now()
from auth.users as u
where u.deleted_at is null
  and u.email is not null
  and btrim(coalesce(nullif(btrim(u.raw_user_meta_data->>'username'), ''), split_part(u.email, '@', 1))) <> ''
on conflict (user_id) do update
  set username = excluded.username, updated_at = excluded.updated_at;

create or replace function public.resolve_username_login(p_username text)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = pharmacy_private, pg_temp
as $$
  select i.user_id
  from pharmacy_private.auth_login_identifiers as i
  where lower(btrim(i.username)) = lower(btrim(p_username))
  limit 2;
$$;

revoke all on function public.resolve_username_login(text) from public, anon, authenticated;
grant execute on function public.resolve_username_login(text) to service_role;

create table if not exists pharmacy_private.username_login_attempts (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  failure_count integer not null default 0 check (failure_count >= 0)
);

alter table pharmacy_private.username_login_attempts enable row level security;
revoke all on table pharmacy_private.username_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on table pharmacy_private.username_login_attempts to service_role;
create index if not exists username_login_attempts_window_idx
  on pharmacy_private.username_login_attempts (window_started_at);

create or replace function public.check_username_login_rate_limit(
  p_key_hashes text[],
  p_limits integer[],
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pharmacy_private
as $$
declare
  v_index integer;
  v_attempts integer;
  v_window_started_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_key_hashes), 0) = 0
     or cardinality(p_key_hashes) <> cardinality(p_limits)
     or p_window_seconds < 1 then
    return false;
  end if;

  for v_index in 1..cardinality(p_key_hashes) loop
    if p_key_hashes[v_index] !~ '^[0-9a-f]{64}$' or p_limits[v_index] < 1 then
      return false;
    end if;
    select a.failure_count, a.window_started_at
      into v_attempts, v_window_started_at
      from pharmacy_private.username_login_attempts as a
      where a.key_hash = p_key_hashes[v_index];
    if found
       and v_window_started_at > v_now - make_interval(secs => p_window_seconds)
       and v_attempts >= p_limits[v_index] then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.record_username_login_failure(
  p_key_hashes text[],
  p_window_seconds integer default 900
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pharmacy_private
as $$
declare
  v_key text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_window_seconds < 1 then
    raise exception 'invalid window' using errcode = '22023';
  end if;
  foreach v_key in array coalesce(p_key_hashes, array[]::text[]) loop
    if v_key !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid rate-limit key' using errcode = '22023';
    end if;
    insert into pharmacy_private.username_login_attempts as attempts (key_hash, window_started_at, failure_count)
      values (v_key, v_now, 1)
    on conflict (key_hash) do update set
      window_started_at = case
        when attempts.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
        else attempts.window_started_at
      end,
      failure_count = case
        when attempts.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
        else attempts.failure_count + 1
      end;
  end loop;
  delete from pharmacy_private.username_login_attempts
    where window_started_at < v_now - interval '1 day';
end;
$$;

revoke all on function public.check_username_login_rate_limit(text[], integer[], integer) from public, anon, authenticated;
revoke all on function public.record_username_login_failure(text[], integer) from public, anon, authenticated;
grant execute on function public.check_username_login_rate_limit(text[], integer[], integer) to service_role;
grant execute on function public.record_username_login_failure(text[], integer) to service_role;
