import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32 } from 'bech32';

const OP_0 = 0x00;
const OP_1 = 0x51;
const OP_16 = 0x60;
const OP_CHECKMULTISIG = 0xae;
const OP_RETURN = 0x6a;
const OP_PUSH_33 = 0x21;
const SIGHASH_ALL = 0x01;

const TAG = Buffer.from('BIP0322-signed-message', 'utf8');

interface ParsedMultisig {
  m: number;
  pubkeys: Buffer[];
}

export function isP2wshAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  if (!address.startsWith('bc1q') || address.length !== 62) return false;
  try {
    const decoded = bech32.decode(address);
    if (decoded.prefix !== 'bc' || decoded.words[0] !== 0) return false;
    const program = bech32.fromWords(decoded.words.slice(1));
    return program.length === 32;
  } catch {
    return false;
  }
}

export function verifyBip322P2wshSignature(message: string, address: string, signatureBase64: string): boolean {
  try {
    const program = decodeP2wshAddress(address);
    if (!program) return false;

    const witness = decodeSimpleSignature(signatureBase64);
    if (!witness) return false;
    if (witness.length < 3) return false;

    const witnessScript = witness[witness.length - 1];
    if (!Buffer.from(sha256(witnessScript)).equals(program)) return false;

    const parsed = parseStandardMultisigScript(witnessScript);
    if (!parsed) return false;

    const dummy = witness[0];
    if (dummy.length !== 0) return false;

    const sigs = witness.slice(1, witness.length - 1);
    if (sigs.length !== parsed.m) return false;

    const sighash = computeBip143Sighash(message, program, witnessScript);

    return verifyMultisig(sigs, parsed.pubkeys, sighash);
  } catch {
    return false;
  }
}

function decodeP2wshAddress(address: string): Buffer | null {
  if (typeof address !== 'string') return null;
  if (!address.startsWith('bc1q') || address.length !== 62) return null;

  const decoded = bech32.decode(address);
  if (decoded.prefix !== 'bc') return null;
  if (decoded.words[0] !== 0) return null;

  const program = Buffer.from(bech32.fromWords(decoded.words.slice(1)));
  if (program.length !== 32) return null;

  return program;
}

function decodeSimpleSignature(signatureBase64: string): Buffer[] | null {
  const buf = Buffer.from(signatureBase64, 'base64');
  if (buf.length === 0) return null;

  let offset = 0;
  const count = readVarInt(buf, offset);
  if (!count) return null;
  offset = count.next;

  const items: Buffer[] = [];
  for (let i = 0; i < count.value; i++) {
    const len = readVarInt(buf, offset);
    if (!len) return null;
    offset = len.next;

    if (offset + len.value > buf.length) return null;
    items.push(buf.subarray(offset, offset + len.value));
    offset += len.value;
  }

  if (offset !== buf.length) return null;

  return items;
}

function parseStandardMultisigScript(script: Buffer): ParsedMultisig | null {
  if (script.length < 1 + 1 + 1) return null;

  const mOp = script[0];
  if (mOp < OP_1 || mOp > OP_16) return null;
  const m = mOp - OP_1 + 1;

  const lastTwo = script.subarray(script.length - 2);
  if (lastTwo[1] !== OP_CHECKMULTISIG) return null;

  const nOp = lastTwo[0];
  if (nOp < OP_1 || nOp > OP_16) return null;
  const n = nOp - OP_1 + 1;

  if (m > n) return null;

  const pubkeys: Buffer[] = [];
  let offset = 1;
  const end = script.length - 2;

  while (offset < end) {
    if (script[offset] !== OP_PUSH_33) return null;
    offset += 1;
    if (offset + 33 > end) return null;
    const pk = script.subarray(offset, offset + 33);
    if (pk[0] !== 0x02 && pk[0] !== 0x03) return null;
    pubkeys.push(pk);
    offset += 33;
  }

  if (offset !== end) return null;
  if (pubkeys.length !== n) return null;

  return { m, pubkeys };
}

function computeBip143Sighash(message: string, program: Buffer, witnessScript: Buffer): Buffer {
  const messageHash = hashMessage(message);
  const scriptPubKey = Buffer.concat([Buffer.from([OP_0, 0x20]), program]);
  const toSpendTxid = computeToSpendTxid(messageHash, scriptPubKey);

  const outpoint = Buffer.concat([toSpendTxid, uint32LE(0)]);
  const sequence = uint32LE(0);

  const hashPrevouts = hash256(outpoint);
  const hashSequence = hash256(sequence);

  const output = Buffer.concat([uint64LE(0n), Buffer.from([0x01, OP_RETURN])]);
  const hashOutputs = hash256(output);

  const preimage = Buffer.concat([
    uint32LE(0),
    hashPrevouts,
    hashSequence,
    outpoint,
    encodeVarBytes(witnessScript),
    uint64LE(0n),
    sequence,
    hashOutputs,
    uint32LE(0),
    uint32LE(SIGHASH_ALL),
  ]);

  return hash256(preimage);
}

function hashMessage(message: string): Buffer {
  const tagHash = sha256(TAG);
  const inner = Buffer.concat([Buffer.from(tagHash), Buffer.from(tagHash), Buffer.from(message, 'utf8')]);
  return Buffer.from(sha256(inner));
}

function computeToSpendTxid(messageHash: Buffer, scriptPubKey: Buffer): Buffer {
  const scriptSig = Buffer.concat([Buffer.from([OP_0, 0x20]), messageHash]);
  const tx = Buffer.concat([
    uint32LE(0),
    encodeVarInt(1),
    Buffer.alloc(32),
    uint32LE(0xffffffff),
    encodeVarBytes(scriptSig),
    uint32LE(0),
    encodeVarInt(1),
    uint64LE(0n),
    encodeVarBytes(scriptPubKey),
    uint32LE(0),
  ]);
  return hash256(tx);
}

function verifyMultisig(sigs: Buffer[], pubkeys: Buffer[], sighash: Buffer): boolean {
  let pkIdx = 0;
  for (const sig of sigs) {
    if (sig.length === 0) return false;
    const sighashType = sig[sig.length - 1];
    if (sighashType !== SIGHASH_ALL) return false;
    const der = sig.subarray(0, sig.length - 1);

    let matched = false;
    while (pkIdx < pubkeys.length) {
      const pk = pubkeys[pkIdx];
      pkIdx += 1;
      if (verifyEcdsa(der, sighash, pk)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function verifyEcdsa(derSignature: Buffer, sighash: Buffer, pubkey: Buffer): boolean {
  try {
    const compact = secp256k1.Signature.fromDER(derSignature).normalizeS().toCompactRawBytes();
    return secp256k1.verify(compact, sighash, pubkey);
  } catch {
    return false;
  }
}

function hash256(buf: Buffer): Buffer {
  return Buffer.from(sha256(sha256(buf)));
}

function uint32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function uint64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

function encodeVarInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  if (n <= 0xffffffff) {
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = 0xff;
  b.writeBigUInt64LE(BigInt(n), 1);
  return b;
}

function encodeVarBytes(bytes: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(bytes.length), bytes]);
}

function readVarInt(buf: Buffer, offset: number): { value: number; next: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first < 0xfd) return { value: first, next: offset + 1 };
  if (first === 0xfd) {
    if (offset + 3 > buf.length) return null;
    return { value: buf.readUInt16LE(offset + 1), next: offset + 3 };
  }
  if (first === 0xfe) {
    if (offset + 5 > buf.length) return null;
    return { value: buf.readUInt32LE(offset + 1), next: offset + 5 };
  }
  if (offset + 9 > buf.length) return null;
  const big = buf.readBigUInt64LE(offset + 1);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { value: Number(big), next: offset + 9 };
}
