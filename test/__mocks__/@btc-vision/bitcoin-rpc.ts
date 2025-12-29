// Mock for @btc-vision/bitcoin-rpc

export interface RPCConfig {
  BITCOIND_HOST: string;
  BITCOIND_PORT: number;
  BITCOIND_USERNAME: string;
  BITCOIND_PASSWORD: string;
}

export enum BitcoinVerbosity {
  RAW = 1,
  NONE = 0,
}

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  time: number;
  mediantime: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  chainwork: string;
  size_on_disk: number;
  pruned: boolean;
  warnings: string;
}

export class BitcoinRPC {
  constructor(_timeout?: number, _debug?: boolean) {}

  async init(_config: any): Promise<void> {}

  destroy(): void {}

  async getBlockCount(): Promise<number> {
    return 0;
  }

  async getChainInfo(): Promise<BlockchainInfo> {
    return {
      chain: 'main',
      blocks: 0,
      headers: 0,
      bestblockhash: '',
      difficulty: 0,
      time: 0,
      mediantime: 0,
      verificationprogress: 0,
      initialblockdownload: false,
      chainwork: '',
      size_on_disk: 0,
      pruned: false,
      warnings: '',
    };
  }

  async getBlockHash(_height: number): Promise<string> {
    return '';
  }

  async getRawTransaction<_T>(_params: any): Promise<any> {
    return null;
  }

  async getNewAddress(_label: string): Promise<string> {
    return '';
  }

  async listWallets(): Promise<string[]> {
    return [];
  }

  async getWalletInfo(_name: string): Promise<any> {
    return { balance: 0 };
  }

  async send(_outputs: any[], _options?: any): Promise<any> {
    return { txid: '' };
  }

  async sendRawTransaction(_params: any): Promise<string> {
    return '';
  }

  async estimateSmartFee(_confTarget: number): Promise<any> {
    return { feeRate: 0.00001 };
  }

  async decodeRawTransaction(_hex: string): Promise<any> {
    return {};
  }
}
