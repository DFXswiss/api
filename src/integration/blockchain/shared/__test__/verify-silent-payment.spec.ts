import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32m } from 'bech32';

/**
 * Tests for Silent Payment (BIP-352) signature verification logic.
 *
 * Simulates the full Cake Wallet → DFX API flow:
 * 1. Construct a SP address from known b_scan + b_spend keypairs
 * 2. Sign a Bitcoin message with b_spend private key (Cake Wallet side)
 * 3. Verify: decode SP address, recover pubkey from signature, compare to B_spend (DFX API side)
 */
describe('verifySilentPayment', () => {
  // Deterministic test keypairs
  const bScanPriv = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const bSpendPriv = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  const bScanPub = Buffer.from(secp256k1.getPublicKey(bScanPriv, true));
  const bSpendPub = Buffer.from(secp256k1.getPublicKey(bSpendPriv, true));

  // Construct SP address: version 0 + B_scan (33 bytes) + B_spend (33 bytes)
  const spPayload = Buffer.concat([bScanPub, bSpendPub]);
  const spWords = [0, ...bech32m.toWords(spPayload)];
  const spAddress = bech32m.encode('sp1', spWords, 1023);

  // Mirrors CryptoService.verifySilentPayment() logic (including try-catch)
  function verifySilentPayment(message: string, address: string, signature: string): boolean {
    try {
      const decoded = bech32m.decode(address, 1023);
      const dataBytes = Buffer.from(bech32m.fromWords(decoded.words.slice(1)));
      if (dataBytes.length !== 66) return false;
      const bSpend = dataBytes.subarray(33, 66);

      const prefix = '\x18Bitcoin Signed Message:\n';
      const msgBytes = Buffer.from(message, 'utf8');
      const varint = encodeVarint(msgBytes.length);
      const prefixBytes = Buffer.from(prefix, 'utf8');
      const payload = Buffer.concat([prefixBytes, varint, msgBytes]);
      const msgHash = sha256(sha256(payload));

      const sigBuf = Buffer.from(signature, 'base64');
      if (sigBuf.length !== 65) return false;
      const recoveryFlag = sigBuf[0];
      const recoveryId = (recoveryFlag >= 31 ? recoveryFlag - 31 : recoveryFlag - 27) & 3;
      const r = sigBuf.subarray(1, 33);
      const s = sigBuf.subarray(33, 65);
      const sig = new secp256k1.Signature(
        BigInt('0x' + Buffer.from(r).toString('hex')),
        BigInt('0x' + Buffer.from(s).toString('hex')),
      ).addRecoveryBit(recoveryId);

      const recoveredPoint = sig.recoverPublicKey(msgHash);
      const recoveredBytes = recoveredPoint.toRawBytes(true);

      return Buffer.from(recoveredBytes).equals(Buffer.from(bSpend));
    } catch {
      return false;
    }
  }

  // Simulates Cake Wallet signing
  function signBitcoinMessage(message: string, privKeyHex: string): string {
    const prefix = '\x18Bitcoin Signed Message:\n';
    const msgBytes = Buffer.from(message, 'utf8');
    const varint = encodeVarint(msgBytes.length);
    const prefixBytes = Buffer.from(prefix, 'utf8');
    const payload = Buffer.concat([prefixBytes, varint, msgBytes]);
    const msgHash = sha256(sha256(payload));

    const sig = secp256k1.sign(msgHash, privKeyHex);
    const recoveryFlag = 31 + sig.recovery;
    const sigBuf = Buffer.alloc(65);
    sigBuf[0] = recoveryFlag;
    Buffer.from(sig.toCompactRawBytes()).copy(sigBuf, 1);

    return sigBuf.toString('base64');
  }

  it('should construct a valid SP address starting with sp1', () => {
    expect(spAddress).toMatch(/^sp1/);
  });

  it('should decode SP address back to correct B_spend', () => {
    const decoded = bech32m.decode(spAddress, 1023);
    const dataBytes = Buffer.from(bech32m.fromWords(decoded.words.slice(1)));
    expect(dataBytes.length).toBe(66);
    expect(Buffer.from(dataBytes.subarray(33, 66)).equals(bSpendPub)).toBe(true);
  });

  it('should verify a valid signature signed with b_spend', () => {
    const message =
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_' +
      spAddress;
    const signature = signBitcoinMessage(message, bSpendPriv);

    expect(verifySilentPayment(message, spAddress, signature)).toBe(true);
  });

  it('should reject a signature from b_scan (wrong key)', () => {
    const message = 'test message';
    const wrongSignature = signBitcoinMessage(message, bScanPriv);

    expect(verifySilentPayment(message, spAddress, wrongSignature)).toBe(false);
  });

  it('should reject a signature for a different message', () => {
    const signature = signBitcoinMessage('original message', bSpendPriv);

    expect(verifySilentPayment('different message', spAddress, signature)).toBe(false);
  });

  it('should reject a signature from a completely different key', () => {
    const otherPrivValid = '1111111111111111111111111111111111111111111111111111111111111111';
    const message = 'test';
    const wrongSig = signBitcoinMessage(message, otherPrivValid);

    expect(verifySilentPayment(message, spAddress, wrongSig)).toBe(false);
  });

  it('should return false for invalid signature length', () => {
    expect(verifySilentPayment('test', spAddress, Buffer.alloc(32).toString('base64'))).toBe(false);
  });

  it('should return false for invalid base64 signature', () => {
    expect(verifySilentPayment('test', spAddress, 'not-valid!!')).toBe(false);
  });

  it('should verify multiple different messages independently', () => {
    const msg1 = 'first message';
    const msg2 = 'second message';
    const sig1 = signBitcoinMessage(msg1, bSpendPriv);
    const sig2 = signBitcoinMessage(msg2, bSpendPriv);

    expect(verifySilentPayment(msg1, spAddress, sig1)).toBe(true);
    expect(verifySilentPayment(msg2, spAddress, sig2)).toBe(true);

    // Cross-verify should fail
    expect(verifySilentPayment(msg1, spAddress, sig2)).toBe(false);
    expect(verifySilentPayment(msg2, spAddress, sig1)).toBe(false);
  });
});

function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xfe;
  buf.writeUInt32LE(n, 1);
  return buf;
}
