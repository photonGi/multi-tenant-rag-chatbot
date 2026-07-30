-- =============================================================================
-- Embeddable chat widget — sites, public keys, install telemetry
-- =============================================================================
-- Additive. Run after scripts/schema.sql; it touches no existing table.
--
-- WHY THIS EXISTS
-- ---------------
-- `companies.api_key` is a god-key: the same value authorises /webhook/chat AND
-- /webhook/ingest. It is safe in a share link handed to named people, but a
-- widget puts its credential in the HTML source of a public website, where
-- anyone can read it. Shipping companies.api_key that way would let a stranger
-- POST poisoned documents into the tenant's vector index.
--
-- So a widget authenticates with a *different* credential — widget_sites.public_key —
-- which is chat-only, origin-bound, rate-limited and revocable on its own. It is
-- never accepted by the ingest path, and it never reaches n8n: the server swaps
-- it for the internal key after the origin check.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.widget_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Human label for the dashboard list ("Marketing site", "Docs").
  name text NOT NULL,

  -- The embeddable credential. `pk_live_` prefix so it is recognisable on
  -- sight in a customer's HTML and greppable in secret scanners — it is
  -- public by design, but a reviewer should still be able to tell what it is.
  public_key text UNIQUE NOT NULL,

  -- Browser origins allowed to load and query this widget, as scheme://host[:port]
  -- with no trailing slash. Matching is exact against the request's Origin
  -- header, except entries beginning '*.' which match one-or-more subdomain
  -- labels (see lib/widget/origins.ts — it is the sole authority on matching).
  allowed_origins text[] NOT NULL DEFAULT '{}',

  -- Origins seen in real traffic that are NOT in allowed_origins. The widget
  -- stays inert for these, but recording them turns "my staging deploy is
  -- broken" into a one-click approve in the dashboard instead of a support
  -- ticket. Capped in code at ORIGIN_OBSERVATION_LIMIT.
  pending_origins text[] NOT NULL DEFAULT '{}',

  -- Launcher + panel appearance. Server-held on purpose: the customer pastes
  -- the snippet once and never has to touch their codebase again to restyle.
  -- Shape and defaults live in lib/widget/theme.ts.
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- pending  — created, never seen a real page load
  -- active   — verified and serving
  -- disabled — owner switched it off; keeps the row and its stats
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),

  -- Install telemetry. Set by the verify beacon, which is what lets the
  -- dashboard flip to "Connected" without the owner clicking anything.
  verified_at timestamptz,
  last_seen_at timestamptz,
  last_seen_origin text,
  load_count bigint NOT NULL DEFAULT 0,
  message_count bigint NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_widget_sites_company_id
  ON public.widget_sites (company_id);

-- Every widget request begins with this lookup, on a route with no session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_widget_sites_public_key
  ON public.widget_sites (public_key);

-- -----------------------------------------------------------------------------
-- 3. updated_at
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS widget_sites_set_updated_at ON public.widget_sites;
CREATE TRIGGER widget_sites_set_updated_at
  BEFORE UPDATE ON public.widget_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------
-- Owners manage their own sites through the anon key + their session. The
-- widget's own runtime never reads this table under RLS: those routes are
-- anonymous, so they use the service_role key, which bypasses RLS entirely.
-- That asymmetry is deliberate — it means there is NO policy granting `anon`
-- read access to public_key, so the table cannot be enumerated from a browser.
ALTER TABLE public.widget_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS widget_sites_select_company ON public.widget_sites;
CREATE POLICY widget_sites_select_company ON public.widget_sites
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS widget_sites_insert_company ON public.widget_sites;
CREATE POLICY widget_sites_insert_company ON public.widget_sites
  FOR INSERT TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS widget_sites_update_company ON public.widget_sites;
CREATE POLICY widget_sites_update_company ON public.widget_sites
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS widget_sites_delete_company ON public.widget_sites;
CREATE POLICY widget_sites_delete_company ON public.widget_sites
  FOR DELETE TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 5. Telemetry RPC
-- -----------------------------------------------------------------------------
-- Counters are incremented from concurrent anonymous requests. Doing it as
-- read-modify-write from the API route would lose increments under load and
-- cost a second round trip; this is one atomic statement.
--
-- Also folds in the state machine the beacon drives: first sighting stamps
-- verified_at and promotes pending -> active. `disabled` is left alone, so a
-- site the owner switched off does not resurrect itself on the next page load.
CREATE OR REPLACE FUNCTION public.widget_site_seen(
  site_id uuid,
  seen_origin text,
  is_message boolean DEFAULT false
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.widget_sites
  SET
    last_seen_at  = now(),
    last_seen_origin = COALESCE(seen_origin, last_seen_origin),
    load_count    = load_count + (CASE WHEN is_message THEN 0 ELSE 1 END),
    message_count = message_count + (CASE WHEN is_message THEN 1 ELSE 0 END),
    verified_at   = COALESCE(verified_at, now()),
    status        = CASE WHEN status = 'pending' THEN 'active' ELSE status END
  WHERE id = site_id;
$$;

-- Records an origin the widget was loaded from but is not allowed to serve.
-- Array-append rather than a child table: the list is owner-facing, tiny, and
-- read only in the dashboard — a table would add a join for no benefit.
-- The cardinality guard stops a hostile embedder from growing the row forever.
CREATE OR REPLACE FUNCTION public.widget_site_note_origin(
  site_id uuid,
  candidate text,
  max_pending integer DEFAULT 10
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.widget_sites
  SET pending_origins = array_append(pending_origins, candidate)
  WHERE id = site_id
    AND candidate IS NOT NULL
    AND candidate <> ''
    AND NOT (candidate = ANY(pending_origins))
    AND NOT (candidate = ANY(allowed_origins))
    AND cardinality(pending_origins) < max_pending;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grants
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.widget_sites
  TO authenticated, service_role;

-- SECURITY DEFINER above means these run as the owner; only service_role may
-- call them, so an end user cannot inflate another tenant's counters.
REVOKE ALL ON FUNCTION public.widget_site_seen(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_site_note_origin(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.widget_site_seen(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.widget_site_note_origin(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 7. Verify
-- -----------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'widget_sites'
ORDER BY ordinal_position;
