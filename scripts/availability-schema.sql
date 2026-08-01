-- =============================================================================
-- Bookable availability — the hours the assistant is allowed to offer
-- =============================================================================
-- Additive. Run after scripts/meetings-schema.sql.
--
-- WHY A TABLE AND NOT A COLUMN ON companies
-- -----------------------------------------
-- These four values are read together on every booking attempt and written
-- together from one form. Hanging them off `companies` would widen the row every
-- surface in the app already selects, for data only the booking path cares
-- about. One row per workspace, enforced by the UNIQUE below, which is also what
-- gives the console's upsert a conflict target.
--
-- WHY `timezone` LIVES HERE AND NOT ON companies
-- ----------------------------------------------
-- `companies.display_timezone` answers "how should the console render times to
-- the person looking at it" and is allowed to be NULL, meaning "follow their
-- browser". That is exactly wrong for availability: "09:00" has to mean one
-- specific instant to a lead in another country, and it cannot depend on whose
-- browser last opened the page. So the schedule carries its own zone, NOT NULL,
-- seeded from the display zone but independent of it afterwards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE rather than a plain FK: one schedule per workspace. It also supplies
  -- the company_id index, so no separate CREATE INDEX is needed below.
  company_id uuid UNIQUE NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- IANA zone the hours below are expressed in. The anchor that turns "09:00"
  -- into a real instant. Never NULL — see the header.
  timezone text NOT NULL DEFAULT 'UTC',

  -- Open hours per weekday, as local wall-clock times in `timezone`:
  --
  --   {"mon":[{"start":"09:00","end":"17:00"}], "sat":[], ...}
  --
  -- Wall-clock and not offsets, deliberately. "I work 9 to 5" stays true across
  -- a daylight-saving change; an offset baked in at save time silently shifts
  -- every meeting by an hour twice a year.
  --
  -- An empty array is a day off. A day may hold several ranges, which is how a
  -- lunch break is expressed — 09:00-12:30 and 13:30-17:00 rather than one span
  -- with a hole in it.
  --
  -- Shape is validated in the app (lib/availability/schedule.ts is the
  -- authority, and it normalises whatever it reads); the constraint here only
  -- rules out a value that is not an object at all.
  weekly_hours jsonb NOT NULL DEFAULT '{
    "mon": [{"start": "09:00", "end": "17:00"}],
    "tue": [{"start": "09:00", "end": "17:00"}],
    "wed": [{"start": "09:00", "end": "17:00"}],
    "thu": [{"start": "09:00", "end": "17:00"}],
    "fri": [{"start": "09:00", "end": "17:00"}],
    "sat": [],
    "sun": []
  }'::jsonb
    CHECK (jsonb_typeof(weekly_hours) = 'object'),

  -- How long one meeting runs, and therefore the grid the open hours are cut
  -- into. Bounded so a typo cannot produce a zero-length slot (infinite slots
  -- in a day) or a week-long one.
  slot_minutes integer NOT NULL DEFAULT 30
    CHECK (slot_minutes BETWEEN 5 AND 480),

  -- Dead time kept clear after each booking. Applied after, not before: a gap
  -- on both sides double-counts between two consecutive meetings.
  buffer_minutes integer NOT NULL DEFAULT 0
    CHECK (buffer_minutes BETWEEN 0 AND 240),

  -- How far ahead of now the earliest offered slot must be, so a lead cannot
  -- book something four minutes from now. Capped at 30 days.
  minimum_notice_minutes integer NOT NULL DEFAULT 120
    CHECK (minimum_notice_minutes BETWEEN 0 AND 43200),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. updated_at
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS availability_schedules_set_updated_at ON public.availability_schedules;
CREATE TRIGGER availability_schedules_set_updated_at
  BEFORE UPDATE ON public.availability_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Row Level Security
-- -----------------------------------------------------------------------------
-- Same shape as every other table here. The console edits this directly, as it
-- does widget_sites and email_templates; the booking workflow reads it as
-- service_role, which bypasses RLS.
ALTER TABLE public.availability_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS availability_select_company ON public.availability_schedules;
CREATE POLICY availability_select_company ON public.availability_schedules
  FOR SELECT TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS availability_insert_company ON public.availability_schedules;
CREATE POLICY availability_insert_company ON public.availability_schedules
  FOR INSERT TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS availability_update_company ON public.availability_schedules;
CREATE POLICY availability_update_company ON public.availability_schedules
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS availability_delete_company ON public.availability_schedules;
CREATE POLICY availability_delete_company ON public.availability_schedules
  FOR DELETE TO authenticated USING (
    company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 4. Grants
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_schedules
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 5. Verify
-- -----------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'availability_schedules'
ORDER BY ordinal_position;
