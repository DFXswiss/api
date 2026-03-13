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
