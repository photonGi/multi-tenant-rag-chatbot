/** A file is one way to give a workspace context, not the only one. */
export type SourceKind = 'file' | 'text' | 'url'

/** The set the file picker accepts, plus the text formats ingest handles. */
const FILE_EXTENSIONS = /\.(txt|pdf|docx?|png|jpe?g|md|csv|json)$/i

/**
 * Recovers what a source was from the name it was stored under.
 *
 * `source_name` is built per mode — an absolute URL for a website, the filename
 * for a file, the chosen label for pasted text — so the kind is recoverable
 * without a schema change, and existing rows classify correctly with no
 * backfill.
 *
 * URL detection is exact. The file test uses the same extensions the picker
 * accepts, so a text label would have to end in one to be mistaken for a file —
 * and that only affects an icon and a badge, never which chunks get deleted.
 */
export function classifySource(sourceName: string): SourceKind {
  if (/^https?:\/\//i.test(sourceName)) return 'url'
  if (FILE_EXTENSIONS.test(sourceName)) return 'file'
  return 'text'
}

export const SOURCE_BADGE: Record<SourceKind, string> = {
  file: 'FILE',
  text: 'TEXT',
  url: 'WEB',
}

/** Used in the delete confirmation, so it names what is actually going. */
export const SOURCE_NOUN: Record<SourceKind, string> = {
  file: 'file',
  text: 'text snippet',
  url: 'website reference',
}
