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
// These replicate the subset of @arkade-os/sdk used by ArkService.verifySignature,
// using only CJS-compatible root dependencies to avoid ESM issues in Jest.

const { p2tr, taprootListToTree, TAPROOT_UNSPENDABLE_KEY } = require('@scure/btc-signer');
const { bech32m } = require('bech32');

const TAP_LEAF_VERSION = 0xc0;

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

function buildExitScript(pubKey: Uint8Array): Uint8Array {
  // <144 blocks> OP_CHECKSEQUENCEVERIFY OP_DROP <pubkey> OP_CHECKSIG
  const buf = new Uint8Array(1 + 2 + 1 + 1 + 1 + 32 + 1);
  buf[0] = 0x02;
  buf[1] = 0x90;
  buf[2] = 0x00; // 144 LE
  buf[3] = 0xb2; // OP_CHECKSEQUENCEVERIFY
  buf[4] = 0x75; // OP_DROP
  buf[5] = 0x20;
  buf.set(pubKey, 6);
  buf[38] = 0xac;
  return buf;
}

class _DefaultVtxoScript {
  readonly tweakedPublicKey: Uint8Array;

  constructor(options: { pubKey: Uint8Array; serverPubKey: Uint8Array }) {
    const { pubKey, serverPubKey } = options;
    const scripts = [buildForfeitScript(pubKey, serverPubKey), buildExitScript(pubKey)];
    const tapTree = taprootListToTree(scripts.map((s: Uint8Array) => ({ script: s, leafVersion: TAP_LEAF_VERSION })));
    const payment = p2tr(TAPROOT_UNSPENDABLE_KEY, tapTree, undefined, true);
    this.tweakedPublicKey = payment.tweakedPubkey;
  }
}

export const ArkAddress = _ArkAddress;
export const DefaultVtxo = { Script: _DefaultVtxoScript };
