/* eslint-disable @typescript-eslint/no-require-imports */

// --- Wallet / Identity mocks (used by other tests) --- //

export class Wallet {
  static async create(): Promise<Wallet> {
    return new Wallet();
  }

  async getAddress(): Promise<string> {
    return 'ark1mock';
  }

  async getBalance(): Promise<{ available: number }> {
    return { available: 0 };
  }

  async sendBitcoin(): Promise<string> {
    return 'mock-txid';
  }

  async getVtxos(): Promise<unknown[]> {
    return [];
  }

  async finalizePendingTxs(): Promise<{ finalized: string[]; pending: string[] }> {
    return { finalized: [], pending: [] };
  }
}

export class SingleKey {
  static fromHex(_hex: string): SingleKey {
    return new SingleKey();
  }
}

export class MnemonicIdentity {}
export class SeedIdentity {}
export class ReadonlyWallet {}

// --- Crypto primitives for address verification (CJS-compatible re-implementations) --- //
// These replicate the subset of @arkade-os/sdk used by ArkadeService.verifySignature,
// using only CJS-compatible root dependencies to avoid ESM issues in Jest.

const { p2tr, taprootListToTree, TAPROOT_UNSPENDABLE_KEY } = require('@scure/btc-signer');
const { bech32m } = require('bech32');
const bip68 = require('bip68');

const TAP_LEAF_VERSION = 0xc0;

interface RelativeTimelock {
  value: bigint;
  type: 'seconds' | 'blocks';
}

const DEFAULT_TIMELOCK: RelativeTimelock = { value: 144n, type: 'blocks' };

class _ArkAddress {
  readonly serverPubKey: Uint8Array;
  readonly vtxoTaprootKey: Uint8Array;
  readonly hrp: string;
  readonly version: number;

  constructor(serverPubKey: Uint8Array, vtxoTaprootKey: Uint8Array, hrp: string, version = 0) {
    this.serverPubKey = serverPubKey;
    this.vtxoTaprootKey = vtxoTaprootKey;
    this.hrp = hrp;
    this.version = version;
  }

  static decode(address: string): _ArkAddress {
    const decoded = bech32m.decode(address, 1023);
    const data = new Uint8Array(bech32m.fromWords(decoded.words));
    if (data.length !== 65) throw new Error(`Invalid data length, expected 65 bytes, got ${data.length}`);

    return new _ArkAddress(data.slice(1, 33), data.slice(33, 65), decoded.prefix, data[0]);
  }

  encode(): string {
    const data = new Uint8Array(1 + 32 + 32);
    data[0] = this.version;
    data.set(this.serverPubKey, 1);
    data.set(this.vtxoTaprootKey, 33);
    return bech32m.encode(this.hrp, bech32m.toWords(data), 1023);
  }
}

function buildForfeitScript(pubKey: Uint8Array, serverPubKey: Uint8Array): Uint8Array {
  // <pubkey> OP_CHECKSIGVERIFY <serverkey> OP_CHECKSIG
  const buf = new Uint8Array(1 + 32 + 1 + 1 + 32 + 1);
  buf[0] = 0x20;
  buf.set(pubKey, 1);
  buf[33] = 0xad;
  buf[34] = 0x20;
  buf.set(serverPubKey, 35);
  buf[67] = 0xac;
  return buf;
}

function minimalScriptNum(n: number): Uint8Array {
  if (n === 0) return new Uint8Array(0);
  const negative = n < 0;
  let abs = Math.abs(n);
  const bytes: number[] = [];
  while (abs > 0) {
    bytes.push(abs & 0xff);
    abs >>= 8;
  }
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(negative ? 0x80 : 0x00);
  } else if (negative) {
    bytes[bytes.length - 1] |= 0x80;
  }
  return new Uint8Array(bytes);
}

function buildExitScript(pubKey: Uint8Array, csvTimelock: RelativeTimelock = DEFAULT_TIMELOCK): Uint8Array {
  // <sequence> OP_CHECKSEQUENCEVERIFY OP_DROP <pubkey> OP_CHECKSIG
  const sequence = bip68.encode(
    csvTimelock.type === 'blocks' ? { blocks: Number(csvTimelock.value) } : { seconds: Number(csvTimelock.value) },
  );
  const seqBytes = minimalScriptNum(sequence);
  const pushOp = seqBytes.length === 1 ? [] : [seqBytes.length]; // OP_N for 1 byte, else explicit push
  const seqPush = seqBytes.length === 1 ? [seqBytes[0]] : [...pushOp, ...seqBytes];

  const buf = new Uint8Array(seqPush.length + 1 + 1 + 1 + 32 + 1);
  let offset = 0;
  for (const b of seqPush) buf[offset++] = b;
  buf[offset++] = 0xb2; // OP_CHECKSEQUENCEVERIFY
  buf[offset++] = 0x75; // OP_DROP
  buf[offset++] = 0x20; // push 32 bytes
  buf.set(pubKey, offset);
  offset += 32;
  buf[offset++] = 0xac; // OP_CHECKSIG
  return buf.slice(0, offset);
}

function buildMultisigScript(pubkeys: Uint8Array[]): Uint8Array {
  // <pk1> CHECKSIGVERIFY ... <pkN> CHECKSIG
  const parts: number[] = [];
  for (let i = 0; i < pubkeys.length; i++) {
    parts.push(0x20); // push 32 bytes
    parts.push(...pubkeys[i]);
    parts.push(i < pubkeys.length - 1 ? 0xad : 0xac); // CHECKSIGVERIFY / CHECKSIG
  }
  return new Uint8Array(parts);
}

function buildTaprootTree(scripts: Uint8Array[]): Uint8Array {
  // Reverse odd-length script arrays (VtxoScript base class behavior)
  const list = scripts.length % 2 !== 0 ? scripts.slice().reverse() : scripts;
  const tapTree = taprootListToTree(list.map((s: Uint8Array) => ({ script: s, leafVersion: TAP_LEAF_VERSION })));
  const payment = p2tr(TAPROOT_UNSPENDABLE_KEY, tapTree, undefined, true);
  return payment.tweakedPubkey;
}

class _DefaultVtxoScript {
  readonly tweakedPublicKey: Uint8Array;
  readonly scripts: Uint8Array[];

  constructor(options: { pubKey: Uint8Array; serverPubKey: Uint8Array; csvTimelock?: RelativeTimelock }) {
    const { pubKey, serverPubKey, csvTimelock } = options;
    this.scripts = [buildForfeitScript(pubKey, serverPubKey), buildExitScript(pubKey, csvTimelock)];
    this.tweakedPublicKey = buildTaprootTree(this.scripts);
  }
}

class _DelegateVtxoScript {
  readonly tweakedPublicKey: Uint8Array;

  constructor(options: {
    pubKey: Uint8Array;
    serverPubKey: Uint8Array;
    delegatePubKey: Uint8Array;
    csvTimelock?: RelativeTimelock;
  }) {
    const { pubKey, serverPubKey, delegatePubKey, csvTimelock } = options;
    const defaultVtxo = new _DefaultVtxoScript({ pubKey, serverPubKey, csvTimelock });
    const delegateScript = buildMultisigScript([pubKey, delegatePubKey, serverPubKey]);
    const allScripts = [...defaultVtxo.scripts, delegateScript];
    this.tweakedPublicKey = buildTaprootTree(allScripts);
  }
}

export const ArkAddress = _ArkAddress;
export const DefaultVtxo = { Script: _DefaultVtxoScript };
export const DelegateVtxo = { Script: _DelegateVtxoScript };
