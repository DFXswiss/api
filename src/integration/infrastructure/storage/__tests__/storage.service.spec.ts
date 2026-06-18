import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { MockStorageService } from '../mock-storage.service';

describe('StorageService', () => {
  let service: MockStorageService;

  beforeAll(async () => {
    await Test.createTestingModule({
      providers: [TestUtil.provideConfig({ s3: { publicUrl: 'https://files.example.com/' } })],
    }).compile();

    service = new MockStorageService('kyc');
  });

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

    it('builds the public URL from the configured base with encoded segments', () => {
      expect(service.blobUrl('a b/c#d')).toBe('https://files.example.com/kyc/a%20b/c%23d');
    });

    it('rejects a URL that does not belong to the container', () => {
      expect(() => service.blobName('https://example.com/other/file.png')).toThrow();
    });
  });
});
