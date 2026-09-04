-- ---------------------------------------------------------------------------
-- 0002_app_role — a role that row level security actually applies to.
--
-- Why this exists: 0001 enables and FORCES RLS on every table, and the catalog
-- says so. But the connection string from setup step A4 authenticates as
-- Supabase's `postgres` role, and that role carries BYPASSRLS. RLS is not
-- checked at all for a role holding that attribute — not even FORCE overrides
-- it. So before this file, every policy in 0001 was decoration:
--
--     withTenant(fn, 'some-other-tenant')  ->  returned OUR rows
--     no app.tenant_id set at all          ->  returned OUR rows
--
-- The fix is not to strip BYPASSRLS from `postgres` (Supabase's own tooling
-- runs as that role). It is to give the application a role without it, and
-- have the application drop into that role for the duration of its work:
--
--     set local role front_desk_app;
--
-- `set local` lasts to the end of the transaction, so it pairs exactly with the
-- transaction-local app.tenant_id in src/db/client.ts withTenant().
--
-- front_desk_app is NOLOGIN on purpose: it is reached by SET ROLE from the
-- existing connection, so nothing new goes in .env and no second password
-- exists to leak. Milestone 1 is read-only, but the write grants are here
-- because the pipeline that loads the data runs through the same connection.
--
-- Steps:
--   1. The role
--   2. Grants on what exists now
--   3. Default privileges, so a table added by a later migration is covered
-- ---------------------------------------------------------------------------

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'front_desk_app') then
    create role front_desk_app nologin nobypassrls noinherit;
  end if;
end $$;

-- Membership is what makes `set role front_desk_app` legal from the app's
-- connection. It grants no extra power: front_desk_app is strictly weaker.
grant front_desk_app to current_user;

-- ---------------------------------------------------------------------------
-- 2. Grants on what exists now
-- ---------------------------------------------------------------------------

grant usage on schema public to front_desk_app;
grant select, insert, update, delete on all tables in schema public to front_desk_app;
grant usage, select on all sequences in schema public to front_desk_app;

-- ---------------------------------------------------------------------------
-- 3. Default privileges for tables added later
--    Scoped to the role that runs migrations, which is the role that will own
--    any future table.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  grant select, insert, update, delete on tables to front_desk_app;
alter default privileges in schema public
  grant usage, select on sequences to front_desk_app;

comment on role front_desk_app is
  'Application role. No BYPASSRLS, so the tenant policies in 0001 are actually '
  'enforced. Reached with: set local role front_desk_app;';
