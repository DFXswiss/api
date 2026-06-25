import { ConfigService } from 'src/config/config';
import { AuthService } from '../auth.service';

// Regression guard for the custodial-Lightning sign-in bypass: an empty stored signature must never
// authenticate. verifySignature is private, so we exercise it via bracket access with a bare instance
// (the Lightning branch only uses getSignMessages + the static CryptoService.getBlockchainsBasedOn).
describe('AuthService custodial Lightning signature check', () => {
  let service: AuthService;

  // LNNID + 66 alnum → recognised as a Lightning address by CryptoService
  const lightningAddress = `LNNID${'A'.repeat(66)}`;
  // 140 lowercase alnum → matches the custodial-Lightning signature shape
  const validShapeSignature = 'a'.repeat(140);

  const verify = (signature: string, dbSignature: string | undefined, isSignUp = false): Promise<boolean> =>
    (
      service as unknown as {
        verifySignature: (
          address: string,
          signature: string,
          isCustodial: boolean,
          key: string | undefined,
          dbSignature: string | undefined,
          blockchain: undefined,
          isSignUp: boolean,
        ) => Promise<boolean>;
      }
    ).verifySignature(lightningAddress, signature, false, undefined, dbSignature, undefined, isSignUp);

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    service = Object.create(AuthService.prototype);
  });

  it('rejects sign-in when the stored signature is empty (account takeover guard)', async () => {
    await expect(verify(validShapeSignature, '')).resolves.toBe(false);
    await expect(verify(validShapeSignature, undefined)).resolves.toBe(false);
  });

  it('rejects sign-in when the signature does not match the stored one', async () => {
    await expect(verify(validShapeSignature, 'b'.repeat(140))).resolves.toBe(false);
  });

  it('accepts sign-in when the signature matches a non-empty stored signature', async () => {
    await expect(verify(validShapeSignature, validShapeSignature)).resolves.toBe(true);
  });

  it('accepts sign-up (establishes the first signature) even without a stored signature', async () => {
    await expect(verify(validShapeSignature, undefined, true)).resolves.toBe(true);
  });
});
