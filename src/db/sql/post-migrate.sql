-- Runs after every migration batch, as realestate_owner. Must stay idempotent.
-- CLAUDE.md §5 Multi-tenancy.

-- 1. Row-level security on every tenant table (any table with organization_id),
--    except Better Auth tables that Better Auth itself scopes.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND tb.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('member', 'invitation')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t.table_name AND policyname = 'tenant_isolation'
    ) THEN
      -- NULLIF: once set in a session, an unset custom GUC reads back as '' instead of NULL.
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I
           USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)
           WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
        t.table_name
      );
    END IF;
  END LOOP;
END
$$;

-- 2. Runtime role privileges: DML only, re-applied to cover new tables.
GRANT USAGE ON SCHEMA public TO realestate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO realestate_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO realestate_app;

-- 3. Append-only / never-deleted tables (CLAUDE.md §7 Audit & deletion).
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM realestate_app;
