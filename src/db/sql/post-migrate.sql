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
REVOKE UPDATE, DELETE, TRUNCATE ON public.unit_status_history FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.unit_price_history FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.lead_activity FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.quotation_line FROM realestate_app;
-- Issued documents are cancelled, never deleted (status, PDF link and cancellation are updated).
REVOKE DELETE, TRUNCATE ON public.quotation FROM realestate_app;

-- 4. Payments and receipts are immutable (CLAUDE.md §7): no delete; only the cancellation
--    columns (and a cheque's clearance, a receipt's PDF link) can be updated.
REVOKE UPDATE, DELETE, TRUNCATE ON public.payment FROM realestate_app;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancellation_reason, cheque_cleared_on)
  ON public.payment TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.receipt FROM realestate_app;
GRANT UPDATE (status, cancelled_at, pdf_file_id) ON public.receipt TO realestate_app;
-- Sales are never deleted (withdrawal changes their status).
REVOKE DELETE, TRUNCATE ON public.reservation FROM realestate_app;
-- Payment calls and reminder letters are issued once; only their PDF link is set afterwards.
REVOKE UPDATE, DELETE, TRUNCATE ON public.payment_call FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.payment_call TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.reminder_letter FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.reminder_letter TO realestate_app;
-- After-sale history: transfers and unit swaps are append-only; withdrawals are never deleted.
REVOKE UPDATE, DELETE, TRUNCATE ON public.reservation_transfer FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.unit_swap FROM realestate_app;
REVOKE DELETE, TRUNCATE ON public.withdrawal FROM realestate_app;
-- Charge calls are issued once: a period only changes when it is cancelled (with a reason),
-- its calls only get their PDF link, their lines never change.
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_period FROM realestate_app;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancellation_reason)
  ON public.charge_period TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_call FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.charge_call TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_call_line FROM realestate_app;
