-- =============================================================================
-- Workspace display timezone
-- =============================================================================
-- Additive and idempotent. Run after scripts/meetings-schema.sql.
--
-- WHY
-- ---
-- `meetings.timezone` records the zone the *booking* was made in — whatever the
-- lead's browser reported, which in practice is 'Asia/Kolkata' on one row, the
-- legacy alias 'IST' on the next, and null on the one after. Rendering each row
-- in its own recorded zone made the console's list impossible to read down: no
-- two rows were comparable, and none of them were in the zone of the person
-- reading them.
--
-- `starts_at` is a timestamptz, so it already names an exact instant no matter
-- what any row claims its zone was. This column decides which zone the console
-- renders those instants in. It changes nothing about the meetings, the calendar
-- events, or the confirmation emails — only the display.
--
-- NULL means "use whatever zone the viewer's browser is set to", which is the
-- right default for an owner who has never opened the setting.
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS display_timezone text;

COMMENT ON COLUMN public.companies.display_timezone IS
  'IANA zone name the console renders meeting times in. NULL = follow the viewer''s browser.';

-- No new policy or grant: `companies` already has owner-scoped RLS from
-- scripts/schema.sql, and the console updates this row through the same
-- companies_update_own policy that key rotation uses.

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'companies'
  AND column_name = 'display_timezone';
