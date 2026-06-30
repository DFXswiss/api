import { createSign, generateKeyPairSync } from 'crypto';
import { Config, ConfigService } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { ScorechainService } from '../scorechain.service';

describe('ScorechainService', () => {
  let service: ScorechainService;
  let privateKey: string;

  beforeAll(() => {
    new ConfigService();
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    Config.scorechain.publicKey = pair.publicKey;
  });

  beforeEach(() => {
    service = new ScorechainService({} as HttpService);
  });

  // Mirrors the Scorechain SDK: sign RSA-SHA256 over JSON.stringify({ data, timestamp }), hex.
  const sign = (data: unknown, time: string) =>
    createSign('RSA-SHA256')
      .update(JSON.stringify({ data, timestamp: time }))
      .sign(privateKey, 'hex');

  describe('isValidSignature', () => {
    const data = { id: 'abc', lowestScore: 80 };
    const time = '1782820050';

    it('accepts a valid signature', async () => {
      await expect(service.isValidSignature(data, sign(data, time), time)).resolves.toBe(true);
    });

    it('rejects a tampered payload (fail-closed)', async () => {
      const signature = sign(data, time);
      await expect(service.isValidSignature({ id: 'abc', lowestScore: 1 }, signature, time)).resolves.toBe(false);
    });

    it('rejects a wrong server time (fail-closed)', async () => {
      await expect(service.isValidSignature(data, sign(data, time), '9999999999')).resolves.toBe(false);
    });

    it('rejects a missing signature (fail-closed)', async () => {
      await expect(service.isValidSignature(data, undefined, time)).resolves.toBe(false);
    });

    it('rejects missing data (fail-closed)', async () => {
      await expect(service.isValidSignature(null, sign(data, time), time)).resolves.toBe(false);
    });
  });
});
