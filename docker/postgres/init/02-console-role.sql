-- The operator's console (CLAUDE.console.md §3): its own role, never owner, never bypasses RLS.
-- Idempotent: `pnpm docker:up` applies it again to volumes created before it existed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'realestate_console') THEN
    CREATE ROLE realestate_console LOGIN PASSWORD 'console'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
