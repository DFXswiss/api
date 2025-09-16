import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';

export interface SparkTransaction {
  txid: string;
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  fee?: number;
  hex?: string;
  vin?: SparkInput[];
  vout?: SparkOutput[];
}

export interface SparkInput {
  txid: string;
  vout: number;
  scriptSig?: {
    asm: string;
    hex: string;
  };
  sequence: number;
}

export interface SparkOutput {
  value: number;
  n: number;
  scriptPubKey?: {
    address?: string;
    type: string;
    hex: string;
  };
}

export interface SparkUTXO {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
}

export interface SparkNodeInfo {
  version: string;
  protocolversion: number;
  blocks: number;
  connections: number;
  difficulty: number;
  testnet: boolean;
  relayfee: number;
}

export interface SparkFeeEstimate {
  feerate: number;
  blocks: number;
}

@Injectable()
export class SparkClient {
  private readonly logger = new DfxLogger(SparkClient);

  constructor(private readonly http: HttpService) {}

  get nodeUrl(): string {
    return Config.blockchain.spark?.nodeUrl ?? 'http://localhost:8332';
  }

  get walletAddress(): string {
    return Config.blockchain.spark?.address ?? '';
  }

  private get rpcAuth(): { username: string; password: string } {
    return {
      username: Config.blockchain.spark?.rpcUser ?? 'spark',
      password: Config.blockchain.spark?.rpcPassword ?? '',
    };
  }

  // --- TRANSACTION METHODS --- //

  async sendMany(
    outputs: { addressTo: string; amount: number }[],
    feeRate: number,
  ): Promise<string> {
    try {
      const recipients = outputs.reduce(
        (acc, p) => ({ ...acc, [p.addressTo]: this.roundAmount(p.amount) }),
        {},
      );

      const result = await this.rpcCall<string>('sendmany', [
        '',
        recipients,
        1,
        '',
        [],
        true,
        feeRate,
      ]);

      this.logger.verbose(`Spark transaction sent: ${result}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to send Spark transaction:', error);
      throw error;
    }
  }

  async sendTransaction(
    to: string,
    amount: number,
    feeRate: number,
  ): Promise<{ txid: string; fee: number }> {
    try {
      const amountStr = this.roundAmount(amount).toString();

      const txid = await this.rpcCall<string>('sendtoaddress', [
        to,
        amountStr,
        '',
        '',
        true,
        true,
        null,
        'unset',
        null,
        feeRate,
      ]);

      // Get transaction to determine actual fee
      const tx = await this.getTransaction(txid);

      return { txid, fee: Math.abs(tx.fee ?? 0) };
    } catch (error) {
      this.logger.error('Failed to send Spark transaction:', error);
      throw error;
    }
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    try {
      return await this.rpcCall<SparkTransaction>('gettransaction', [txId, true]);
    } catch (error) {
      this.logger.error(`Failed to get transaction ${txId}:`, error);
      throw error;
    }
  }

  async getRawTransaction(txId: string, verbose = true): Promise<SparkTransaction | string> {
    return this.rpcCall<SparkTransaction | string>('getrawtransaction', [txId, verbose]);
  }

  async sendRawTransaction(hexString: string): Promise<string> {
    return this.rpcCall<string>('sendrawtransaction', [hexString]);
  }

  // --- UTXO METHODS --- //

  async listUnspent(
    minConf = 1,
    maxConf = 9999999,
    addresses?: string[],
  ): Promise<SparkUTXO[]> {
    return this.rpcCall<SparkUTXO[]>('listunspent', [minConf, maxConf, addresses || []]);
  }

  async getUTXOsForAddress(address: string): Promise<SparkUTXO[]> {
    return this.listUnspent(1, 9999999, [address]);
  }

  // --- BALANCE METHODS --- //

  async getBalance(address?: string): Promise<number> {
    if (address) {
      const utxos = await this.getUTXOsForAddress(address);
      return utxos.reduce((sum, utxo) => sum + utxo.amount, 0);
    }
    return this.rpcCall<number>('getbalance');
  }

  async getWalletBalance(): Promise<number> {
    return this.rpcCall<number>('getbalance');
  }

  // --- FEE METHODS --- //

  async estimateFee(blocks = 6): Promise<SparkFeeEstimate> {
    try {
      const feerate = await this.rpcCall<number>('estimatesmartfee', [blocks]);
      return { feerate, blocks };
    } catch (error) {
      // Fallback to default fee if estimation fails
      this.logger.warn('Fee estimation failed, using default:', error);
      return { feerate: 0.00001, blocks };
    }
  }

  async getNetworkFeeRate(): Promise<number> {
    const estimate = await this.estimateFee(6);
    // Convert from SPARK/kB to SPARK/vB
    return estimate.feerate / 1000;
  }

  // --- BLOCKCHAIN INFO --- //

  async getInfo(): Promise<SparkNodeInfo> {
    return this.rpcCall<SparkNodeInfo>('getnetworkinfo');
  }

  async getBlockCount(): Promise<number> {
    return this.rpcCall<number>('getblockcount');
  }

  async getBlockHash(height: number): Promise<string> {
    return this.rpcCall<string>('getblockhash', [height]);
  }

  async getBlock(hashOrHeight: string | number): Promise<any> {
    const hash = typeof hashOrHeight === 'number'
      ? await this.getBlockHash(hashOrHeight)
      : hashOrHeight;
    return this.rpcCall('getblock', [hash]);
  }

  // --- ADDRESS METHODS --- //

  async validateAddress(address: string): Promise<{ isvalid: boolean; address?: string }> {
    return this.rpcCall('validateaddress', [address]);
  }

  async getNewAddress(label = ''): Promise<string> {
    return this.rpcCall<string>('getnewaddress', [label]);
  }

  // --- MEMPOOL METHODS --- //

  async testMempoolAccept(rawtx: string): Promise<Array<{ txid: string; allowed: boolean; 'reject-reason'?: string }>> {
    return this.rpcCall('testmempoolaccept', [[rawtx]]);
  }

  async getMempoolInfo(): Promise<any> {
    return this.rpcCall('getmempoolinfo');
  }

  // --- HELPER METHODS --- //

  private roundAmount(amount: number, decimals = 8): number {
    return Util.round(amount, decimals);
  }

  private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    try {
      const response = await this.http.post(
        this.nodeUrl,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${this.rpcAuth.username}:${this.rpcAuth.password}`).toString('base64'),
          },
        },
      );

      if (response.error) {
        throw new Error(`RPC Error: ${response.error.message || JSON.stringify(response.error)}`);
      }

      return response.result;
    } catch (error) {
      this.logger.error(`RPC call failed for ${method}:`, error);
      throw error;
    }
  }

  // --- STATUS METHODS --- //

  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.getInfo();
      return info.connections > 0;
    } catch {
      return false;
    }
  }

  async isSynced(): Promise<boolean> {
    try {
      const info = await this.getInfo();
      const blockCount = await this.getBlockCount();
      // Consider synced if we have connections and recent blocks
      return info.connections > 0 && blockCount > 0;
    } catch {
      return false;
    }
  }
}