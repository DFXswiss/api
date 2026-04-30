import {
  bip322MessageHash,
  buildSortedMultisigScript,
  buildToSpendTx,
  p2wshAddress,
  p2wshScriptPubKey,
} from '@dfx.swiss/bip322-multisig';
import { secp256k1 } from '@noble/curves/secp256k1';
import { Transaction } from 'bitcoinjs-lib';
import { isP2wshAddress, verifyBip322P2wshSignature } from '../bip322-p2wsh.util';

describe('bip322-p2wsh.util', () => {
  const p2wshAddr = 'bc1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3cep';
  const p2wpkhAddress = 'bc1qd9jvcd4l64q09kkj2q0qpf58umrryknyqmdp47';
  const legacyAddress = '1AcGhh1oYJTqaPgmWThc7EvKBRjRLe3Go9';

  describe('isP2wshAddress', () => {
    it('detects native P2WSH', () => {
      expect(isP2wshAddress(p2wshAddr)).toBe(true);
    });

    it('rejects P2WPKH', () => {
      expect(isP2wshAddress(p2wpkhAddress)).toBe(false);
    });

    it('rejects legacy P2PKH', () => {
      expect(isP2wshAddress(legacyAddress)).toBe(false);
    });

    it('rejects testnet bech32', () => {
      expect(isP2wshAddress('tb1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3cep')).toBe(false);
    });

    it('rejects malformed bech32', () => {
      expect(isP2wshAddress('bc1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3xxx')).toBe(false);
    });

    it('rejects empty input', () => {
      expect(isP2wshAddress('')).toBe(false);
    });
  });

  describe('verifyBip322P2wshSignature - structural negatives', () => {
    const message = 'test';

    it('returns false on empty signature', () => {
      expect(verifyBip322P2wshSignature(message, p2wshAddr, '')).toBe(false);
    });

    it('returns false on garbage base64', () => {
      expect(verifyBip322P2wshSignature(message, p2wshAddr, 'AAAAAAAAAAAAAAAA')).toBe(false);
    });

    it('returns false on non-P2WSH address', () => {
      expect(verifyBip322P2wshSignature(message, p2wpkhAddress, 'AAAAAAAA')).toBe(false);
    });
  });

  describe('verifyBip322P2wshSignature - synthetic 2-of-3 sortedmulti roundtrip', () => {
    const messages = ['hello world', 'DFX challenge: ' + 'x'.repeat(80), ''];

    it.each(messages)('signs and verifies (msg length=%s)', (message) => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const signature = signSyntheticMultisig(message, witnessScript, [privateKeys[0], privateKeys[2]]);

      expect(isP2wshAddress(address)).toBe(true);
      expect(verifyBip322P2wshSignature(message, address, signature)).toBe(true);
    });

    it('rejects signature when only 1 of required 2 sigs provided', () => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const message = 'short';
      const sig = signSyntheticMultisig(message, witnessScript, [privateKeys[0]]);
      expect(verifyBip322P2wshSignature(message, address, sig)).toBe(false);
    });

    it('rejects signature signed for different message', () => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const sig = signSyntheticMultisig('msg-a', witnessScript, [privateKeys[0], privateKeys[1]]);
      expect(verifyBip322P2wshSignature('msg-b', address, sig)).toBe(false);
    });

    it('rejects signature signed by foreign key (not in script)', () => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const intruder = makePrivateKey(99);
      const sig = signSyntheticMultisig('m', witnessScript, [privateKeys[0], intruder]);
      expect(verifyBip322P2wshSignature('m', address, sig)).toBe(false);
    });
  });

  describe('verifyBip322P2wshSignature - real Sparrow fixture', () => {
    it.todo('verifies a real Sparrow BIP-322 simple signature for the 2-of-3 multisig (fixture pending)');
  });
});

// --- test helpers --- //

function makePrivateKey(seed: number): Buffer {
  const k = Buffer.alloc(32);
  k.writeUInt32BE(seed + 1, 28);
  return k;
}

function pubkeyOf(priv: Buffer): Buffer {
  return Buffer.from(secp256k1.getPublicKey(priv, true));
}

function buildSyntheticMultisig(): { address: string; witnessScript: Buffer; privateKeys: Buffer[] } {
  const privateKeys = [makePrivateKey(1), makePrivateKey(2), makePrivateKey(3)];
  const pubkeys = privateKeys.map(pubkeyOf);

  const witnessScript = buildSortedMultisigScript(pubkeys, 2);
  const address = p2wshAddress(witnessScript);

  pubkeys.sort(Buffer.compare);
  privateKeys.sort((a, b) => Buffer.compare(pubkeyOf(a), pubkeyOf(b)));

  return { address, witnessScript, privateKeys };
}

function signSyntheticMultisig(message: string, witnessScript: Buffer, signingKeys: Buffer[]): string {
  const scriptPubKey = p2wshScriptPubKey(witnessScript);
  const messageHash = bip322MessageHash(message);
  const toSpend = buildToSpendTx(messageHash, scriptPubKey);

  const toSign = new Transaction();
  toSign.version = 0;
  toSign.locktime = 0;
  toSign.addInput(toSpend.getHash(), 0, 0);
  toSign.addOutput(Buffer.from([0x6a]), 0);

  const sighash = toSign.hashForWitnessV0(0, witnessScript, 0, Transaction.SIGHASH_ALL);

  const signersByPubkey = new Map(signingKeys.map((k) => [pubkeyOf(k).toString('hex'), k]));
  const scriptPubkeys = extractScriptPubkeys(witnessScript);
  const orderedSigs: Buffer[] = [];
  for (const pk of scriptPubkeys) {
    const priv = signersByPubkey.get(pk.toString('hex'));
    if (!priv) continue;
    const sig = secp256k1.sign(sighash, priv, { lowS: true });
    const der = Buffer.from(sig.toDERRawBytes());
    orderedSigs.push(Buffer.concat([der, Buffer.from([0x01])]));
  }

  const witness = [Buffer.alloc(0), ...orderedSigs, witnessScript];
  return encodeWitness(witness).toString('base64');
}

function extractScriptPubkeys(script: Buffer): Buffer[] {
  const pubkeys: Buffer[] = [];
  let offset = 1;
  const end = script.length - 2;
  while (offset < end) {
    offset += 1;
    pubkeys.push(script.subarray(offset, offset + 33));
    offset += 33;
  }
  return pubkeys;
}

function encodeWitness(items: Buffer[]): Buffer {
  const parts: Buffer[] = [varInt(items.length)];
  for (const item of items) parts.push(varBytes(item));
  return Buffer.concat(parts);
}

function varInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}

function varBytes(b: Buffer): Buffer {
  return Buffer.concat([varInt(b.length), b]);
}
