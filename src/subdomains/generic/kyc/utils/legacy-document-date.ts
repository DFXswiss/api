// Legacy KYC documents from the Spider era lie under `spider/<userDataId>/…` (and
// `spider/<userDataId>-organization/…` for the business documents of the same account), a layout that
// predates the `kyc_file` catalog. The catalog rows describing them carry that key in `kyc_file.path`.

// A path segment that is a bare epoch in milliseconds — the moment of the Spider run, kept in the
// folder name (`online-identification/1699356511987/…`). Thirteen digits is the shape of that window;
// a ten-digit second value is not read as one, because guessing the unit would silently place a
// document in 1970 or in the far future rather than leave it undated.
const EPOCH_MILLIS_PATTERN = /^\d{13}$/;
// Spider predates DFX, so nothing stored under it can be older than this; anything below is a segment
// that merely looks like a timestamp.
const EARLIEST_DOCUMENT_DATE = new Date('2015-01-01T00:00:00.000Z');
// `spider/<owner>/…` — neither segment is part of the document's path within the account.
const SCOPE_AND_OWNER_SEGMENTS = 2;

/**
 * The date of a legacy KYC document, read from its storage key — or nothing, where the key does not
 * carry one.
 *
 * The compliance dossier has to tell a catalog row whose date is the document's from a row whose date
 * is merely the day it was catalogued. The catalog cannot express that difference —
 * `kyc_file.created` is never null — so the date is derived from the key again, by the same rule the
 * one-off catalog run applied when it wrote those rows. That run is gone; its rows are not, and every
 * display of one still asks this question.
 *
 * Only the folder segments are read, and only those after the scope and the owner: a file name may
 * contain any number, and an owner segment that looks like a timestamp is not one. A value outside
 * the plausible window is discarded rather than corrected — an unknown date has to stay unknown,
 * because every consumer of a wrong one reads it as fact.
 */
export function legacyDocumentDate(key: string): Date | undefined {
  const folders = key.split('/').slice(SCOPE_AND_OWNER_SEGMENTS, -1);

  for (const segment of folders) {
    if (!EPOCH_MILLIS_PATTERN.test(segment)) continue;

    const date = new Date(+segment);
    if (date >= EARLIEST_DOCUMENT_DATE && date <= new Date()) return date;
  }

  return undefined;
}
