import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32 } from 'bech32';
import { isP2wshAddress, verifyBip322P2wshSignature } from '../bip322-p2wsh.util';

describe('bip322-p2wsh.util', () => {
  const p2wshAddress = 'bc1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3cep';
  const p2wpkhAddress = 'bc1qd9jvcd4l64q09kkj2q0qpf58umrryknyqmdp47';
  const legacyAddress = '1AcGhh1oYJTqaPgmWThc7EvKBRjRLe3Go9';

  describe('isP2wshAddress', () => {
    it('detects native P2WSH', () => {
      expect(isP2wshAddress(p2wshAddress)).toBe(true);
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
      expect(verifyBip322P2wshSignature(message, p2wshAddress, '')).toBe(false);
    });

    it('returns false on garbage base64', () => {
      expect(verifyBip322P2wshSignature(message, p2wshAddress, 'AAAAAAAAAAAAAAAA')).toBe(false);
    });

    it('returns false on non-P2WSH address', () => {
      expect(verifyBip322P2wshSignature(message, p2wpkhAddress, 'AAAAAAAA')).toBe(false);
    });
  });

  describe('verifyBip322P2wshSignature - synthetic 2-of-3 sortedmulti roundtrip', () => {
    const messages = ['hello world', 'DFX challenge: ' + 'x'.repeat(80), ''];

    it.each(messages)('signs and verifies (msg length=%s)', (message) => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const signature = signSyntheticMultisig(message, address, witnessScript, [privateKeys[0], privateKeys[2]]);

      expect(isP2wshAddress(address)).toBe(true);
      expect(verifyBip322P2wshSignature(message, address, signature)).toBe(true);
    });

    it('rejects signature when only 1 of required 2 sigs provided', () => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const message = 'short';
      const sig = signSyntheticMultisig(message, address, witnessScript, [privateKeys[0]]);
      expect(verifyBip322P2wshSignature(message, address, sig)).toBe(false);
    });

    it('rejects signature signed for different message', () => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const sig = signSyntheticMultisig('msg-a', address, witnessScript, [privateKeys[0], privateKeys[1]]);
      expect(verifyBip322P2wshSignature('msg-b', address, sig)).toBe(false);
    });

    it('rejects signature signed by foreign key (not in script)', () => {
      const { address, witnessScript, privateKeys } = buildSyntheticMultisig();
      const intruder = makePrivateKey(99);
      const sig = signSyntheticMultisig('m', address, witnessScript, [privateKeys[0], intruder]);
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
  pubkeys.sort(Buffer.compare);
  privateKeys.sort((a, b) => Buffer.compare(pubkeyOf(a), pubkeyOf(b)));

  const parts: Buffer[] = [Buffer.from([0x52])]; // OP_2
  for (const pk of pubkeys) parts.push(Buffer.from([0x21]), pk);
  parts.push(Buffer.from([0x53, 0xae])); // OP_3 OP_CHECKMULTISIG
  const witnessScript = Buffer.concat(parts);

  const program = Buffer.from(sha256(witnessScript));
  const words = [0, ...bech32.toWords(program)];
  const address = bech32.encode('bc', words);

  return { address, witnessScript, privateKeys };
}

function signSyntheticMultisig(message: string, address: string, witnessScript: Buffer, signingKeys: Buffer[]): string {
  const program = decodeProgram(address);
  const sighash = computeBip143Sighash(message, program, witnessScript);

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

function decodeProgram(address: string): Buffer {
  const decoded = bech32.decode(address);
  return Buffer.from(bech32.fromWords(decoded.words.slice(1)));
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

function computeBip143Sighash(message: string, program: Buffer, witnessScript: Buffer): Buffer {
  const tag = Buffer.from('BIP0322-signed-message', 'utf8');
  const tagHash = sha256(tag);
  const messageHash = Buffer.from(
    sha256(Buffer.concat([Buffer.from(tagHash), Buffer.from(tagHash), Buffer.from(message, 'utf8')])),
  );

  const scriptPubKey = Buffer.concat([Buffer.from([0x00, 0x20]), program]);
  const scriptSig = Buffer.concat([Buffer.from([0x00, 0x20]), messageHash]);

  const toSpend = Buffer.concat([
    u32le(0),
    varInt(1),
    Buffer.alloc(32),
    u32le(0xffffffff),
    varBytes(scriptSig),
    u32le(0),
    varInt(1),
    u64le(0n),
    varBytes(scriptPubKey),
    u32le(0),
  ]);
  const toSpendTxid = hash256(toSpend);

  const outpoint = Buffer.concat([toSpendTxid, u32le(0)]);
  const sequence = u32le(0);
  const hashPrevouts = hash256(outpoint);
  const hashSequence = hash256(sequence);
  const output = Buffer.concat([u64le(0n), Buffer.from([0x01, 0x6a])]);
  const hashOutputs = hash256(output);

  const preimage = Buffer.concat([
    u32le(0),
    hashPrevouts,
    hashSequence,
    outpoint,
    varBytes(witnessScript),
    u64le(0n),
    sequence,
    hashOutputs,
    u32le(0),
    u32le(1),
  ]);
  return hash256(preimage);
}

function encodeWitness(items: Buffer[]): Buffer {
  const parts: Buffer[] = [varInt(items.length)];
  for (const item of items) parts.push(varBytes(item));
  return Buffer.concat(parts);
}

function hash256(b: Buffer): Buffer {
  return Buffer.from(sha256(sha256(b)));
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
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
