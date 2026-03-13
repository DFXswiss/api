import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bech32m } from 'bech32';
import { BlockchainClient } from '../../util/blockchain-client';
import { Bech32mService } from '../bech32m.service';

class TestBech32mService extends Bech32mService {
  readonly defaultPrefix = 'test';

  getDefaultClient(): BlockchainClient {
    throw new Error('Not implemented');
  }
}

describe('Bech32mService', () => {
  let service: TestBech32mService;

  // Test keypair (deterministic for reproducibility)
  const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true));

  // Derive test address from public key
  const testAddress = bech32m.encode('test', bech32m.toWords(publicKey), 1024);

  // Extended payload address (pubkey embedded in a larger payload)
  const extendedPayload = Buffer.concat([Buffer.alloc(10, 0xff), publicKey]);
  const extendedAddress = bech32m.encode('test', bech32m.toWords(extendedPayload), 1024);

  function signMessage(message: string): string {
    const messageHash = sha256(new TextEncoder().encode(message));
    const sig = secp256k1.sign(messageHash, privateKey);
    return Buffer.from(sig.toCompactRawBytes()).toString('hex');
  }

  beforeEach(() => {
    service = new TestBech32mService();
  });

  // --- SIGNATURE VERIFICATION --- //

  describe('verifySignature', () => {
    it('should verify a valid signature against a pubkey-derived address', async () => {
      const message = 'test message for bech32m verification';
      const signature = signMessage(message);

      const result = await service.verifySignature(message, testAddress, signature);

      expect(result).toBe(true);
    });

    it('should verify a valid signature against an extended address containing the pubkey', async () => {
      const message = 'extended payload test';
      const signature = signMessage(message);

      const result = await service.verifySignature(message, extendedAddress, signature);

      expect(result).toBe(true);
    });

    it('should reject a signature for a different message', async () => {
      const signature = signMessage('original message');

      const result = await service.verifySignature('different message', testAddress, signature);

      expect(result).toBe(false);
    });

    it('should reject a signature for a different address', async () => {
      const message = 'test message';
      const signature = signMessage(message);

      // Create an address from a different key
      const otherPrivKey = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const otherPubKey = Buffer.from(secp256k1.getPublicKey(otherPrivKey, true));
      const otherAddress = bech32m.encode('test', bech32m.toWords(otherPubKey), 1024);

      const result = await service.verifySignature(message, otherAddress, signature);

      expect(result).toBe(false);
    });

    it('should return false for an invalid signature hex', async () => {
      const result = await service.verifySignature('test', testAddress, 'not-valid-hex');

      expect(result).toBe(false);
    });

    it('should return false for an empty signature', async () => {
      const result = await service.verifySignature('test', testAddress, '');

      expect(result).toBe(false);
    });

    it('should return false for a truncated signature', async () => {
      const signature = signMessage('test');
      const truncated = signature.substring(0, 32);

      const result = await service.verifySignature('test', testAddress, truncated);

      expect(result).toBe(false);
    });

    it('should verify signatures with different messages independently', async () => {
      const message1 = 'first message';
      const message2 = 'second message';

      const sig1 = signMessage(message1);
      const sig2 = signMessage(message2);

      expect(await service.verifySignature(message1, testAddress, sig1)).toBe(true);
      expect(await service.verifySignature(message2, testAddress, sig2)).toBe(true);

      // Cross-verify should fail
      expect(await service.verifySignature(message1, testAddress, sig2)).toBe(false);
      expect(await service.verifySignature(message2, testAddress, sig1)).toBe(false);
    });
  });

  // --- PAYMENT REQUEST --- //

  describe('getPaymentRequest', () => {
    it('should return a correctly formatted URI with the default prefix', async () => {
      const result = await service.getPaymentRequest('test1address', 0.001);

      expect(result).toBe('test:test1address?amount=0.00100000');
    });

    it('should format amount with 8 decimal places', async () => {
      const result = await service.getPaymentRequest('test1address', 1);

      expect(result).toBe('test:test1address?amount=1.00000000');
    });

    it('should handle very small amounts', async () => {
      const result = await service.getPaymentRequest('test1address', 0.00000001);

      expect(result).toBe('test:test1address?amount=0.00000001');
    });
  });
});
