import { generateKeyPairSync, createSign } from 'crypto';
import { ConfigService, Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { ScorechainService } from '../scorechain.service';

describe('ScorechainService', () => {
  let service: ScorechainService;
  let publicKey: string;
  let privateKey: string;

  beforeAll(() => {
    new ConfigService();
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
    Config.scorechain.publicKey = publicKey;
  });

  beforeEach(() => {
    service = new ScorechainService({} as HttpService);
  });

  const sign = (data: string) => createSign('RSA-SHA256').update(data).end().sign(privateKey, 'base64');

  describe('isValidSignature', () => {
    it('accepts a signature over body + server time', () => {
      const body = '{"score":10}';
      const time = '1782800000';
      expect(service.isValidSignature(body, sign(`${body}${time}`), time)).toBe(true);
    });

    it('accepts a signature over server time + body (order tolerant)', () => {
      const body = '{"score":10}';
      const time = '1782800000';
      expect(service.isValidSignature(body, sign(`${time}${body}`), time)).toBe(true);
    });

    it('rejects a tampered body (fail-closed)', () => {
      const time = '1782800000';
      const signature = sign(`{"score":10}${time}`);
      expect(service.isValidSignature('{"score":99}', signature, time)).toBe(false);
    });

    it('rejects a missing signature (fail-closed)', () => {
      expect(service.isValidSignature('{"score":10}', undefined, '1782800000')).toBe(false);
    });
  });
});
