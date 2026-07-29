-- =============================================================================
-- Remove orphaned chunks left behind by the old document delete
-- =============================================================================
-- The documents page used to remove chunks with:
--
--   DELETE FROM document_chunks WHERE document_id = <doc id>
--
-- but the n8n ingest workflow writes those rows and only ever receives the api
-- key, source name and label — so it leaves document_id NULL. That filter
-- matched nothing, and every document deleted before the fix left its entire
-- chunk set in the table.
--
-- Those chunks are not merely clutter: match_documents() filters on company_id
-- alone, so they stay retrievable and a deleted document keeps answering
-- questions.
--
-- Run step 1 and read the output before running step 2. Step 2 is destructive
-- and has no undo.
--
-- Chunks are matched to documents on (company_id, source_name) — the pair
-- idx_chunks_company_source covers — because that is the only link the two
-- tables share.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Preview — what step 2 would delete, grouped by workspace and file
-- -----------------------------------------------------------------------------
-- A NULL source_name row here is orphaned by definition: no documents row can
-- ever match it, so nothing will reclaim those chunks.
SELECT
  co.name              AS workspace,
  c.source_name,
  count(*)             AS orphaned_chunks,
  min(c.created_at)    AS first_ingested,
  max(c.created_at)    AS last_ingested
FROM public.document_chunks c
JOIN public.companies co ON co.id = c.company_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.documents d
  WHERE d.company_id = c.company_id
    AND d.source_name = c.source_name
)
GROUP BY co.name, c.source_name
ORDER BY co.name, orphaned_chunks DESC;

-- Totals, for a sense of scale before committing.
SELECT
  count(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.company_id = c.company_id AND d.source_name = c.source_name
    )
  )          AS orphaned_chunks,
  count(*)   AS total_chunks
FROM public.document_chunks c;

-- -----------------------------------------------------------------------------
-- 2. Delete — DESTRUCTIVE. Only chunks with no surviving documents row for the
--    same workspace and source_name.
-- -----------------------------------------------------------------------------
DELETE FROM public.document_chunks AS c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.documents d
  WHERE d.company_id = c.company_id
    AND d.source_name = c.source_name
);

-- -----------------------------------------------------------------------------
-- 3. Verify — should report 0
-- -----------------------------------------------------------------------------
SELECT count(*) AS remaining_orphans
FROM public.document_chunks c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.documents d
  WHERE d.company_id = c.company_id
    AND d.source_name = c.source_name
);
