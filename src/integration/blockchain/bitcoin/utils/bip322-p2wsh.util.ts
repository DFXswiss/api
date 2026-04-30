import { bip322MessageHash, buildToSpendTx, p2wshScriptPubKey } from '@dfx.swiss/bip322-multisig';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bech32 } from 'bech32';
import { crypto as btcCrypto, Transaction } from 'bitcoinjs-lib';

const OP_1 = 0x51;
const OP_16 = 0x60;
const OP_CHECKMULTISIG = 0xae;
const OP_PUSH_33 = 0x21;
const SIGHASH_ALL = 0x01;

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
    if (!witness || witness.length < 3) return false;

    const witnessScript = witness[witness.length - 1];
    if (!btcCrypto.sha256(witnessScript).equals(program)) return false;

    const parsed = parseStandardMultisigScript(witnessScript);
    if (!parsed) return false;

    if (witness[0].length !== 0) return false;

    const sigs = witness.slice(1, witness.length - 1);
    if (sigs.length !== parsed.m) return false;

    const sighash = computeSighash(message, witnessScript);

    return verifyMultisig(sigs, parsed.pubkeys, sighash);
  } catch {
    return false;
  }
}

function decodeP2wshAddress(address: string): Buffer | null {
  if (typeof address !== 'string') return null;
  if (!address.startsWith('bc1q') || address.length !== 62) return null;

  const decoded = bech32.decode(address);
  if (decoded.prefix !== 'bc' || decoded.words[0] !== 0) return null;

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

function computeSighash(message: string, witnessScript: Buffer): Buffer {
  const scriptPubKey = p2wshScriptPubKey(witnessScript);
  const messageHash = bip322MessageHash(message);
  const toSpend = buildToSpendTx(messageHash, scriptPubKey);

  const toSign = new Transaction();
  toSign.version = 0;
  toSign.locktime = 0;
  toSign.addInput(toSpend.getHash(), 0, 0);
  toSign.addOutput(Buffer.from([0x6a]), 0);

  return toSign.hashForWitnessV0(0, witnessScript, 0, Transaction.SIGHASH_ALL);
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
