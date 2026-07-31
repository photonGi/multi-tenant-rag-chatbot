-- =============================================================================
-- Meeting booking — Google connection, confirmation email, booked meetings
-- =============================================================================
-- Additive. Run after scripts/schema.sql; it touches no existing table.
--
-- WHAT THIS ADDS
-- --------------
--   oauth_connections — one Google account per workspace, holding the tokens
--                       the booking workflow uses to write a calendar event and
--                       send the confirmation mail *as the tenant*.
--   email_templates   — the tenant-authored confirmation mail.
--   meetings          — what was actually booked, so the console can show it.
--
-- WHY THE TOKENS ARE CIPHERTEXT
-- -----------------------------
-- A Google refresh token is a long-lived credential over the tenant's calendar
-- and outbound mail. Anyone holding the database — a leaked backup, a stray
-- read-replica, a misconfigured dashboard — would otherwise hold every tenant's
-- mailbox. They are encrypted in the app (AES-256-GCM, lib/google/tokens.ts)
-- with a key that lives only in the environment, so the database alone is not
-- enough to use them.
--
-- That is also why `authenticated` gets a *column-limited* grant below: even
-- with RLS satisfied, an owner's browser session cannot select the two
-- encrypted columns. Only the service-role key used by the server routes can.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- The tenant's connected Google account.
--
-- One row per (workspace, provider): connecting again re-consents the same
-- mailbox rather than accumulating rows, which is what the UNIQUE constraint
-- below gives the callback's upsert a conflict target for.
CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Only Google today. Kept as a column rather than assumed, so adding
  -- Microsoft later is a new value and not a new table.
  provider text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),

  -- The mailbox that consented. Shown in the console so an owner can tell
  -- which account they actually connected, and read by the workflow so the
  -- confirmation mail is sent from the right address.
  connected_email text,

  -- AES-256-GCM ciphertext, never plaintext. See lib/google/tokens.ts for the
  -- envelope format; it carries its own version prefix so the key can be
  -- rotated without a migration.
  refresh_token_encrypted text,
  access_token_encrypted text,

  -- When the access token above stops working. The internal token endpoint
  -- refreshes ahead of this rather than waiting for a 401 mid-booking.
  token_expiry timestamptz,

  -- 'primary' is Google's alias for the account's own calendar, which is what
  -- the calendar.events scope grants. A tenant booking into a shared calendar
  -- can have this pointed at that calendar's id instead.
  calendar_id text NOT NULL DEFAULT 'primary',

  -- connected — usable
  -- revoked   — the owner disconnected, or Google rejected the refresh token
  --             (invalid_grant, which is what a revoke from the Google account
  --             page looks like from here)
  -- error     — refresh failed for some other reason; needs looking at
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'revoked', 'error')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, provider)
);

-- The confirmation mail, authored per workspace.
--
-- template_key exists so this table can hold the reminder and the cancellation
-- mail later without a schema change; 'meeting_confirmation' is the only key
-- the app writes today.
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  template_key text NOT NULL DEFAULT 'meeting_confirmation',
  subject text NOT NULL,

  -- HTML, with {{variable}} placeholders substituted at send time. The
  -- authoritative list of variables is lib/email/templates.ts — the console's
  -- editor and preview both read it from there, so there is one list and not
  -- two that can drift.
  body_html text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, template_key)
);

-- What was booked. Written by the booking workflow (service_role), read by the
-- console.
CREATE TABLE IF NOT EXISTS public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- The same '<visitor>:<thread>' key the chat workflow scopes its memory to,
  -- so a booking can be traced back to the conversation that produced it.
  memory_key text,

  lead_name text,
  lead_email text,

  starts_at timestamptz,
  ends_at timestamptz,

  -- IANA zone name ('Europe/London'), stored alongside the instants above
  -- because "3pm their time" is what the confirmation mail has to say — and an
  -- offset alone cannot survive a daylight-saving boundary.
  timezone text,

  -- Online meetings carry a Meet link; in-person ones do not.
  is_online boolean NOT NULL DEFAULT true,
  meet_link text,

  -- Google's event id, so a later reschedule or cancellation can find the
  -- event it needs to touch.
  calendar_event_id text,

  -- The workflow writes these values. Anything outside the set is rejected by
  -- the constraint rather than silently stored, so a typo in a workflow node
  -- fails loudly instead of producing a status the console cannot render.
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'cancelled', 'completed')),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Indexes
-- -----------------------------------------------------------------------------
-- Every query in the console is "rows for this workspace", so company_id
-- carries all three.
CREATE INDEX IF NOT EXISTS idx_oauth_connections_company_id
  ON public.oauth_connections (company_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_company_id
  ON public.email_templates (company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_company_id
  ON public.meetings (company_id);

-- The internal token endpoint asks for the *connected* row, and a background
-- sweep for the broken ones, so status is worth its own index.
CREATE INDEX IF NOT EXISTS idx_oauth_connections_status
  ON public.oauth_connections (status);

-- The console lists a workspace's meetings newest-first; this serves that
-- ordering directly instead of sorting the company's rows on every visit.
CREATE INDEX IF NOT EXISTS idx_meetings_company_starts_at
  ON public.meetings (company_id, starts_at DESC);

-- -----------------------------------------------------------------------------
-- 3. updated_at
-- -----------------------------------------------------------------------------
-- public.set_updated_at() comes from scripts/schema.sql.
DROP TRIGGER IF EXISTS oauth_connections_set_updated_at ON public.oauth_connections;
CREATE TRIGGER oauth_connections_set_updated_at
  BEFORE UPDATE ON public.oauth_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS email_templates_set_updated_at ON public.email_templates;
CREATE TRIGGER email_templates_set_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------
-- Same shape as every other table here: a row is reachable only through a
-- company the caller owns. The service_role key used by the API routes and by
-- n8n bypasses RLS entirely, which is what lets the anonymous booking workflow
-- write a meetings row.
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- oauth_connections: SELECT only.
--
-- Every write goes through a server route holding the encryption key — the
-- callback, the refresh, the disconnect. There is nothing an owner's browser
-- could correctly write here, so it is granted nothing: no INSERT policy means
-- a stolen anon session cannot plant a connection pointing at an attacker's
-- mailbox.
DROP POLICY IF EXISTS oauth_connections_select_company ON public.oauth_connections;
CREATE POLICY oauth_connections_select_company ON public.oauth_connections
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- email_templates: the console edits these directly, as it does widget_sites.
DROP POLICY IF EXISTS email_templates_select_company ON public.email_templates;
CREATE POLICY email_templates_select_company ON public.email_templates
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS email_templates_insert_company ON public.email_templates;
CREATE POLICY email_templates_insert_company ON public.email_templates
  FOR INSERT TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS email_templates_update_company ON public.email_templates;
CREATE POLICY email_templates_update_company ON public.email_templates
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS email_templates_delete_company ON public.email_templates;
CREATE POLICY email_templates_delete_company ON public.email_templates
  FOR DELETE TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- meetings: read-only from the console. The record of what was booked is
-- written by the workflow; an owner editing it would only desynchronise it
-- from the calendar event it describes.
DROP POLICY IF EXISTS meetings_select_company ON public.meetings;
CREATE POLICY meetings_select_company ON public.meetings
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 5. Grants
-- -----------------------------------------------------------------------------
-- RLS above decides which rows; these decide which columns and verbs.
--
-- The oauth_connections grant is deliberately column-limited: refresh_token_encrypted
-- and access_token_encrypted are absent, so PostgREST refuses to return them to
-- a browser session even though RLS would have allowed the row. Defence in
-- depth — the ciphertext is useless without the environment key, but there is
-- no reason for it to travel to a browser at all.
GRANT SELECT (
  id, company_id, provider, connected_email, token_expiry, calendar_id,
  status, created_at, updated_at
) ON public.oauth_connections TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_connections TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates
  TO authenticated, service_role;

GRANT SELECT ON public.meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO service_role;

-- PostgREST caches the schema; this makes the new tables visible immediately
-- rather than on the next event-trigger reload.
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 6. Verify
-- -----------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('oauth_connections', 'email_templates', 'meetings')
ORDER BY table_name, ordinal_position;
