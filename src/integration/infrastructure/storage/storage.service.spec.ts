import { MockStorageService } from './mock-storage.service';

describe('StorageService', () => {
  const service = new MockStorageService('kyc');

  describe('blobUrl / blobName round-trip', () => {
    // This reversibility is the load-bearing migration invariant: URLs produced by
    // uploadBlob are persisted in the DB and must decode back to the exact object key.
    const keys = [
      'user/123/Identification/id_front.png',
      'spider/9/report.pdf',
      'user/1/notes/file with spaces.pdf',
      'user/2/notes/special #&+%.png',
      'user/3/Ausweis/Gruesse_Uemlaeuet.png',
    ];

    it.each(keys)('reverses %s exactly', (key) => {
      expect(service.blobName(service.blobUrl(key))).toBe(key);
    });

    it('url-encodes each path segment but preserves separators', () => {
      expect(service.blobUrl('a b/c#d')).toContain('kyc/a%20b/c%23d');
    });
  });
});
