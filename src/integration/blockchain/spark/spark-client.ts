import { Injectable } from '@nestjs/common';
import { Currency } from '@uniswap/sdk-core';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';

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
export class SparkClient extends BlockchainClient {
  private readonly logger = new DfxLogger(SparkClient);

  constructor(private readonly http: HttpService) {
    super();
  }

  get nodeUrl(): string {
    // TODO: Add spark configuration to Config.blockchain
    return process.env.SPARK_NODE_URL ?? 'http://localhost:8332';
  }

  get walletAddress(): string {
    // TODO: Add spark configuration to Config.blockchain
    return process.env.SPARK_ADDRESS ?? '';
  }

  private get rpcAuth(): { username: string; password: string } {
    return {
      username: process.env.SPARK_RPC_USER ?? 'spark',
      password: process.env.SPARK_RPC_PASSWORD ?? '',
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

      const data = response as any;
      if (data.error) {
        throw new Error(`RPC Error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      return data.result;
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

  // --- BLOCKCHAIN CLIENT INTERFACE METHODS --- //

  async sendSignedTransaction(hex: string): Promise<any> {
    try {
      const txid = await this.sendRawTransaction(hex);
      return { hash: txid };
    } catch (error) {
      return {
        error: {
          code: error.code ?? -1,
          message: error.message ?? 'Unknown error',
        },
      };
    }
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getWalletBalance();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.getBalance(address);
  }

  async getTokenBalance(_asset: Asset, _address?: string): Promise<number> {
    throw new Error('Spark has no tokens');
  }

  async getTokenBalances(_assets: Asset[], _address?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Spark has no tokens');
  }

  async getToken(_asset: Asset): Promise<Currency> {
    throw new Error('Spark has no tokens');
  }

  async getTx(txId: string): Promise<any> {
    return this.getTransaction(txId);
  }

  async isTxComplete(txId: string, minConfirmations = 1): Promise<boolean> {
    const tx = await this.getTransaction(txId);
    return tx.blockhash && tx.confirmations >= minConfirmations;
  }
}