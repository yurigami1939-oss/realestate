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
-- Erasing a prospect (Loi 18-07) clears the details of its timeline; the events stay.
GRANT UPDATE (data) ON public.lead_activity TO realestate_app;
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
-- Treasury: accounts are closed, never deleted; movements only cancelled; cash counts final.
REVOKE DELETE, TRUNCATE ON public.treasury_account FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.treasury_movement FROM realestate_app;
GRANT UPDATE (cancelled_at, cancelled_by, cancellation_reason) ON public.treasury_movement TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.cash_count FROM realestate_app;
-- Schedule amendments (avenants): kept as signed; only the PDF link is set by the job.
REVOKE UPDATE, DELETE, TRUNCATE ON public.schedule_amendment FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.schedule_amendment TO realestate_app;
-- Cheque deposit slips: kept as handed to the bank; only their clearance and PDF link change;
-- their cheques are append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON public.cheque_deposit FROM realestate_app;
GRANT UPDATE (cleared_on, pdf_file_id) ON public.cheque_deposit TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.cheque_deposit_item FROM realestate_app;
-- Unit sheets are kept as handed out; only their PDF link is set by the job.
REVOKE UPDATE, DELETE, TRUNCATE ON public.unit_sheet FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.unit_sheet TO realestate_app;
-- Bank statements and their lines are kept as imported (a statement nothing was matched on may
-- be withdrawn: its rows are deleted), a line only set aside; matches are undone by deleting them.
REVOKE UPDATE, TRUNCATE ON public.bank_statement FROM realestate_app;
REVOKE UPDATE, TRUNCATE ON public.bank_statement_line FROM realestate_app;
GRANT UPDATE (dismissed_at, dismissed_by, dismissal_reason)
  ON public.bank_statement_line TO realestate_app;
REVOKE UPDATE, TRUNCATE ON public.bank_match FROM realestate_app;
-- A residence's checks are archived, never deleted; their visits are kept as recorded (only the
-- certificate's scan is attached or replaced).
REVOKE DELETE, TRUNCATE ON public.residence_check FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.residence_check_visit FROM realestate_app;
GRANT UPDATE (scan_file_id) ON public.residence_check_visit TO realestate_app;
-- Rent revisions are kept as recorded.
-- Charge settlements of leases are cancelled, never edited.
REVOKE UPDATE, DELETE, TRUNCATE ON public.lease_charge_settlement FROM realestate_app;
GRANT UPDATE (cancelled_at, cancellation_reason) ON public.lease_charge_settlement TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.lease_revision FROM realestate_app;
-- Recovery files are closed, never deleted; their steps are append-only; a repayment plan is
-- cancelled, never edited.
REVOKE DELETE, TRUNCATE ON public.charge_recovery FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_recovery_step FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_repayment_plan FROM realestate_app;
GRANT UPDATE (cancelled_at, cancellation_reason) ON public.charge_repayment_plan TO realestate_app;
-- Management mandates: owners are archived and mandates ended, never deleted; owner statements
-- are kept as issued (paid or cancelled, PDF link); a cancelled statement's items are deleted
-- so its rents are reported again.
REVOKE DELETE, TRUNCATE ON public.property_owner FROM realestate_app;
REVOKE DELETE, TRUNCATE ON public.management_mandate FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.owner_statement FROM realestate_app;
GRANT UPDATE (status, paid_on, payment_method, payment_reference, account_id, paid_by,
  cancelled_at, cancellation_reason, cancelled_by, pdf_file_id)
  ON public.owner_statement TO realestate_app;
REVOKE UPDATE, TRUNCATE ON public.owner_statement_item FROM realestate_app;
-- Partner commissions are paid or cancelled, never deleted.
REVOKE DELETE, TRUNCATE ON public.partner_commission FROM realestate_app;
-- Lead capture keys are revoked, never deleted.
REVOKE DELETE, TRUNCATE ON public.lead_capture_key FROM realestate_app;
-- Warranty claims are fixed or rejected, never deleted.
REVOKE DELETE, TRUNCATE ON public.warranty_claim FROM realestate_app;
-- Portal requests are closed, never deleted.
REVOKE DELETE, TRUNCATE ON public.portal_request FROM realestate_app;
-- Certificates (attestations): kept as issued; only the PDF link is set by the job.
REVOKE UPDATE, DELETE, TRUNCATE ON public.certificate FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.certificate TO realestate_app;
-- After-sale history: transfers and unit swaps are append-only; withdrawals are never deleted.
REVOKE UPDATE, DELETE, TRUNCATE ON public.reservation_transfer FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.unit_swap FROM realestate_app;
-- Annex units of a sale: released (withdrawn sale), never edited otherwise nor deleted.
REVOKE UPDATE, DELETE, TRUNCATE ON public.reservation_annex FROM realestate_app;
GRANT UPDATE (released_at) ON public.reservation_annex TO realestate_app;
REVOKE DELETE, TRUNCATE ON public.withdrawal FROM realestate_app;
-- Charge calls are issued once: a period only changes when it is cancelled (with a reason),
-- its calls only get their PDF link, their lines never change.
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_period FROM realestate_app;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancellation_reason)
  ON public.charge_period TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_call FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.charge_call TO realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_call_line FROM realestate_app;
-- Charge payments (and their receipts) are never deleted: only cancellation, cheque clearance
-- and the PDF link change.
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_payment FROM realestate_app;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancellation_reason, cheque_cleared_on, pdf_file_id)
  ON public.charge_payment TO realestate_app;
-- Charge reminder letters are issued once; only their PDF link is set afterwards.
REVOKE UPDATE, DELETE, TRUNCATE ON public.charge_reminder FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.charge_reminder TO realestate_app;
-- A ticket's history is append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON public.ticket_event FROM realestate_app;
-- A handover is never deleted: once its PV is signed it is final (the service refuses changes).
REVOKE DELETE, TRUNCATE ON public.handover FROM realestate_app;
-- Leases are never deleted (ended instead); rent payments and their quittances are immutable:
-- only their cancellation, a cheque's clearance and the PDF link change.
REVOKE DELETE, TRUNCATE ON public.lease FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rent_payment FROM realestate_app;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancellation_reason, cheque_cleared_on, pdf_file_id)
  ON public.rent_payment TO realestate_app;
-- An état des lieux is final once recorded: only its PDF link changes.
REVOKE UPDATE, DELETE, TRUNCATE ON public.lease_inspection FROM realestate_app;
GRANT UPDATE (pdf_file_id) ON public.lease_inspection TO realestate_app;
-- Online payments are never deleted: they keep what the gateway answered (CLAUDE.md §7).
REVOKE DELETE, TRUNCATE ON public.online_payment FROM realestate_app;
-- The WhatsApp log is kept: messages are never deleted (their status follows Meta's webhook).
REVOKE DELETE, TRUNCATE ON public.whatsapp_message FROM realestate_app;
-- Loi 18-07: consents are append-only (the proof); the access log only counts further reads.
REVOKE UPDATE, DELETE, TRUNCATE ON public.consent_event FROM realestate_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.data_access FROM realestate_app;
-- Electronic signatures are the proof: append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON public.e_signature FROM realestate_app;
-- Common rooms are archived and their bookings kept as their history.
REVOKE DELETE, TRUNCATE ON public.common_room FROM realestate_app;
REVOKE DELETE, TRUNCATE ON public.room_booking FROM realestate_app;
-- The visitors' register is kept (names erased after the retention period).
REVOKE DELETE, TRUNCATE ON public.visitor_pass FROM realestate_app;
GRANT UPDATE (last_at, count) ON public.data_access TO realestate_app;
-- Custom roles are archived, never deleted (members keep the trail of what they held).
REVOKE DELETE, TRUNCATE ON public.custom_role FROM realestate_app;
-- SMS messages are kept (sent or failed), never deleted.
REVOKE DELETE, TRUNCATE ON public.sms_message FROM realestate_app;

-- 5. The operator's console (CLAUDE.console.md §3): schema `console`, written by its own role;
--    the app role reaches nothing in it. Never deleted: accounts, plans, add-ons, subscriptions
--    (archived or ended instead); the console's audit trail is append-only.
REVOKE ALL ON SCHEMA console FROM PUBLIC;
GRANT USAGE ON SCHEMA console TO realestate_console;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA console TO realestate_console;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA console TO realestate_console;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA console FROM realestate_console;
REVOKE UPDATE, DELETE ON console.audit_log FROM realestate_console;
REVOKE DELETE ON console.billing_account, console.account_organization, console.plan,
  console.addon, console.subscription, console.subscription_addon, console.document_sequence,
  console.provision, console.operator_profile
  FROM realestate_console;
-- Billing (CLAUDE.console.md §11): invoices and credit notes are immutable but for their PDF,
-- their lines append-only; a payment only gets cancelled (a bounced cheque).
REVOKE UPDATE, DELETE ON console.invoice, console.invoice_line, console.credit_note,
  console.payment FROM realestate_console;
GRANT UPDATE (pdf_key) ON console.invoice, console.credit_note TO realestate_console;
GRANT UPDATE (cancelled_at, cancel_reason, cancelled_by) ON console.payment TO realestate_console;
-- On the tenants' side only what the console needs: who the organizations and their members
-- are, their entitlement (RLS still applies: `withConsoleTenant`), their audit trail.
GRANT USAGE ON SCHEMA public TO realestate_console;
GRANT SELECT ON public.organization, public.member, public."user" TO realestate_console;
GRANT SELECT, INSERT, UPDATE ON public.tenant_entitlement TO realestate_console;
GRANT INSERT ON public.audit_log TO realestate_console;
-- The app reads its organization's entitlement, never writes it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenant_entitlement FROM realestate_app;

-- 6. What a tenant may read of the console (CLAUDE.console.md §3): SECURITY DEFINER functions
--    resolving the current organization's billing account from `app.current_org` (unset → no
--    row). The app role may call them — USAGE on the schema, no privilege on its tables.
CREATE OR REPLACE FUNCTION console.tenant_subscription()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = console, pg_temp
AS $$
  SELECT jsonb_build_object(
    'status', s.status,
    'program', s.program,
    'billingPeriod', s.billing_period,
    'price', s.price::text,
    'discountBp', s.discount_bp,
    'priceLockedUntil', s.price_locked_until,
    'activatedAt', s.activated_at,
    'pilotEndsOn', s.pilot_ends_on,
    'currentPeriodStart', s.current_period_start,
    'currentPeriodEnd', s.current_period_end,
    'plan', jsonb_build_object(
      'code', p.code, 'nameFr', p.name_fr, 'nameAr', p.name_ar,
      'modules', p.modules, 'limits', p.limits, 'onQuote', p.on_quote
    ),
    'addons', coalesce((
      SELECT jsonb_agg(jsonb_build_object('code', a.addon_code, 'price', a.price::text,
                                          'addedOn', a.added_on) ORDER BY a.addon_code)
      FROM subscription_addon a
      WHERE a.subscription_id = s.id AND a.removed_on IS NULL
    ), '[]'::jsonb),
    'organizations', (
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY ao.added_at)
      FROM account_organization ao
      JOIN public.organization o ON o.id = ao.organization_id
      WHERE ao.billing_account_id = s.billing_account_id
    )
  )
  FROM account_organization me
  JOIN subscription s ON s.billing_account_id = me.billing_account_id
  JOIN plan p ON p.id = s.plan_id
  WHERE me.organization_id = nullif(current_setting('app.current_org', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION console.tenant_subscription() FROM PUBLIC;
GRANT USAGE ON SCHEMA console TO realestate_app;
GRANT EXECUTE ON FUNCTION console.tenant_subscription() TO realestate_app;

-- The account's caps and its usage as last measured (CLAUDE.console.md §7): the other
-- organizations' active units for the pooled cap, and the account's managed lots and storage.
CREATE OR REPLACE FUNCTION console.tenant_capacity()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = console, pg_temp
AS $$
  SELECT jsonb_build_object(
    'othersActiveUnits', coalesce(sum(u.active_units) FILTER (WHERE ao.organization_id <> me.organization_id), 0),
    'activeUnits', coalesce(sum(u.active_units), 0),
    'managedLots', coalesce(sum(u.managed_lots), 0),
    'storageBytes', coalesce(sum(u.storage_bytes), 0),
    'measuredOn', max(u.measured_on)
  )
  FROM account_organization me
  JOIN account_organization ao ON ao.billing_account_id = me.billing_account_id
  LEFT JOIN LATERAL (
    SELECT t.active_units, t.managed_lots, t.storage_bytes, t.measured_on
    FROM tenant_usage t
    WHERE t.organization_id = ao.organization_id
    ORDER BY t.measured_on DESC
    LIMIT 1
  ) u ON true
  WHERE me.organization_id = nullif(current_setting('app.current_org', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION console.tenant_capacity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION console.tenant_capacity() TO realestate_app;

-- The account's invoices with their credit notes and what was paid (CLAUDE.console.md §11): the
-- state is derived by the app (`invoiceState`), the PDFs' keys served by its own route.
CREATE OR REPLACE FUNCTION console.tenant_invoices()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = console, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'number', i.number,
    'issuedOn', i.issued_on,
    'dueOn', i.due_on,
    'periodStart', i.period_start,
    'periodEnd', i.period_end,
    'totalTtc', i.total_ttc::text,
    'credited', coalesce((SELECT sum(c.amount_ttc) FROM credit_note c WHERE c.invoice_id = i.id), 0)::text,
    'paid', coalesce((SELECT sum(p.amount) FROM payment p
                      WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL), 0)::text,
    'pdfKey', i.pdf_key,
    'creditNotes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'issuedOn', c.issued_on,
                                          'amountTtc', c.amount_ttc::text, 'pdfKey', c.pdf_key)
                       ORDER BY c.issued_on, c.number)
      FROM credit_note c WHERE c.invoice_id = i.id
    ), '[]'::jsonb)
  ) ORDER BY i.issued_on DESC, i.number DESC), '[]'::jsonb)
  FROM account_organization me
  JOIN invoice i ON i.billing_account_id = me.billing_account_id
  WHERE me.organization_id = nullif(current_setting('app.current_org', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION console.tenant_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION console.tenant_invoices() TO realestate_app;

-- Where to pay the operator (CLAUDE.console.md §11): its legal name, bank and RIB, for the
-- organizations of a client account only.
CREATE OR REPLACE FUNCTION console.tenant_payment_details()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = console, pg_temp
AS $$
  SELECT jsonb_build_object('legalName', o.legal_name, 'bank', o.bank, 'rib', o.rib)
  FROM operator_profile o
  WHERE o.id = 1
    AND EXISTS (
      SELECT 1 FROM account_organization me
      WHERE me.organization_id = nullif(current_setting('app.current_org', true), '')::uuid
    )
$$;
REVOKE ALL ON FUNCTION console.tenant_payment_details() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION console.tenant_payment_details() TO realestate_app;
