import { ArkAddress, DefaultVtxo } from '@arkade-os/sdk';
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
});
