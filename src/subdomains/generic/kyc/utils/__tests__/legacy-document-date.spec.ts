import { legacyDocumentDate } from '../legacy-document-date';

// The date of the DOCUMENT, which the storage cannot answer: after the migration between storage
// backends every object carries the day of that migration. The Spider run kept its own timestamp in
// the folder name, and that is the only place a 2019 document is still distinguishable from a 2023 one.
describe('legacyDocumentDate', () => {
  const owner = 'spider/1234';

  it('reads the epoch segment of the folder', () => {
    expect(legacyDocumentDate(`${owner}/online-identification/1699356511987/report.pdf`)).toEqual(
      new Date(1699356511987),
    );
  });

  it.each([
    ['a folder without a timestamp segment', `${owner}/user-added-document/proof.pdf`],
    ['a run directory that is not a timestamp', `${owner}/check/gen_12/report.pdf`],
    ['a key with no folder at all', `${owner}/loose.pdf`],
  ])('leaves %s undated', (_case, key) => {
    expect(legacyDocumentDate(key)).toBeUndefined();
  });

  // A segment that merely looks like a timestamp is discarded rather than corrected: a wrong date is
  // worse than none, because the row would then claim to date a document it does not.
  it.each([
    ['before the earliest plausible date', '1000000000000'],
    ['in the future', `${Date.now() + 10 * 365 * 24 * 3600 * 1000}`],
    ['not a millisecond value', '1699356511'],
  ])('discards a segment %s', (_case, segment) => {
    expect(legacyDocumentDate(`${owner}/online-identification/${segment}/report.pdf`)).toBeUndefined();
  });

  // The implausible segment must not stop the search: the run timestamp may sit below a folder whose
  // name happens to parse as a number.
  it('keeps looking past a segment outside the plausible window', () => {
    expect(legacyDocumentDate(`${owner}/1000000000000/1699356511987/report.pdf`)).toEqual(new Date(1699356511987));
  });

  // Only the folders are read: a file name may contain any number, including one that parses as a date.
  it('never reads the date out of the file name', () => {
    expect(legacyDocumentDate(`${owner}/user-added-document/1699356511987.pdf`)).toBeUndefined();
  });
});
