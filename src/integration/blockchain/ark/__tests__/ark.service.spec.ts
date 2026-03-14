import { ArkAddress, DefaultVtxo, DelegateVtxo } from '@arkade-os/sdk';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { ArkService } from '../ark.service';

describe('ArkService', () => {
  let service: ArkService;

  // Test keypair (deterministic for reproducibility)
  const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true));
  const xOnlyKey = publicKey.slice(1);

  // Deterministic test server key
  const serverKey = Buffer.alloc(32, 0xaa);

  // Build offchainAddr from DefaultVtxo script
  const vtxoScript = new DefaultVtxo.Script({
    pubKey: xOnlyKey,
    serverPubKey: serverKey,
  });
  const offchainAddr = new ArkAddress(serverKey, vtxoScript.tweakedPublicKey, 'ark').encode();

  function signMessage(message: string): string {
    const messageHash = sha256(new TextEncoder().encode(message));
    const sig = secp256k1.sign(messageHash, privateKey);
    return Buffer.from(sig.toCompactRawBytes()).toString('hex');
  }

  beforeEach(() => {
    // ArkService constructor creates an ArkClient internally, which is mocked via moduleNameMapper
    service = new ArkService();
  });

  // --- PAYMENT REQUEST --- //

  describe('getPaymentRequest', () => {
    it('should return a correctly formatted ark: URI', async () => {
      const result = await service.getPaymentRequest('ark1testaddress', 0.001);

      expect(result).toBe('ark:ark1testaddress?amount=0.00100000');
    });

    it('should format amount with 8 decimal places', async () => {
      const result = await service.getPaymentRequest('ark1testaddress', 1);

      expect(result).toBe('ark:ark1testaddress?amount=1.00000000');
    });

    it('should handle very small amounts', async () => {
      const result = await service.getPaymentRequest('ark1testaddress', 0.00000001);

      expect(result).toBe('ark:ark1testaddress?amount=0.00000001');
    });
  });

  // --- OFFCHAIN ADDRESS SIGNATURE VERIFICATION --- //

  describe('verifySignature with offchainAddr', () => {
    it('should verify a valid signature against an offchainAddr', async () => {
      const message = 'test message for offchain verification';
      const signature = signMessage(message);

      const result = await service.verifySignature(message, offchainAddr, signature);

      expect(result).toBe(true);
    });

    it('should reject a wrong signature against an offchainAddr', async () => {
      const signature = signMessage('original message');

      const result = await service.verifySignature('different message', offchainAddr, signature);

      expect(result).toBe(false);
    });

    it('should reject a signature from a different key against an offchainAddr', async () => {
      const otherPrivKey = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const message = 'test message';
      const messageHash = sha256(new TextEncoder().encode(message));
      const sig = secp256k1.sign(messageHash, otherPrivKey);
      const signature = Buffer.from(sig.toCompactRawBytes()).toString('hex');

      const result = await service.verifySignature(message, offchainAddr, signature);

      expect(result).toBe(false);
    });
  });

  // --- OFFCHAIN ADDRESS WITH SERVER TIMELOCK --- //

  describe('verifySignature with server timelock', () => {
    const serverTimelock = { value: 605184n, type: 'seconds' as const };

    const serverVtxoScript = new DefaultVtxo.Script({
      pubKey: xOnlyKey,
      serverPubKey: serverKey,
      csvTimelock: serverTimelock,
    });
    const serverOffchainAddr = new ArkAddress(serverKey, serverVtxoScript.tweakedPublicKey, 'ark').encode();

    beforeEach(() => {
      // Mock fetch to return the server's unilateralExitDelay
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: async () => ({ unilateralExitDelay: '605184' }),
      } as Response);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should verify a signature against an offchainAddr with server timelock', async () => {
      const message = 'test message for server timelock verification';
      const signature = signMessage(message);

      const result = await service.verifySignature(message, serverOffchainAddr, signature);

      expect(result).toBe(true);
    });

    it('should reject a wrong signature against server-timelock offchainAddr', async () => {
      const signature = signMessage('original message');

      const result = await service.verifySignature('different message', serverOffchainAddr, signature);

      expect(result).toBe(false);
    });
  });

  // --- DELEGATE VTXO ADDRESS --- //

  describe('verifySignature with DelegateVtxo address', () => {
    const serverTimelock = { value: 605184n, type: 'seconds' as const };
    const delegateKey = Buffer.alloc(32, 0xdd);

    const delegateVtxoScript = new DelegateVtxo.Script({
      pubKey: xOnlyKey,
      serverPubKey: serverKey,
      delegatePubKey: delegateKey,
      csvTimelock: serverTimelock,
    });
    const delegateAddr = new ArkAddress(serverKey, delegateVtxoScript.tweakedPublicKey, 'ark').encode();

    beforeEach(() => {
      jest.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/v1/info')) {
          return { json: async () => ({ unilateralExitDelay: '605184' }) } as Response;
        }
        if (urlStr.includes('/v1/delegator/info')) {
          return { json: async () => ({ pubkey: '00' + Buffer.from(delegateKey).toString('hex') }) } as Response;
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should verify a signature against a DelegateVtxo offchainAddr', async () => {
      const message = 'test message for delegate verification';
      const signature = signMessage(message);

      const result = await service.verifySignature(message, delegateAddr, signature);

      expect(result).toBe(true);
    });

    it('should reject a wrong signature against DelegateVtxo offchainAddr', async () => {
      const signature = signMessage('original message');

      const result = await service.verifySignature('different message', delegateAddr, signature);

      expect(result).toBe(false);
    });
  });
});
