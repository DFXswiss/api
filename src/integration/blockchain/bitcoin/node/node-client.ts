import { ServiceUnavailableException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { BlockchainClient } from '../../shared/util/blockchain-client';
import { UTXO } from './dto/bitcoin-transaction.dto';
import { BitcoinRpcClient, BitcoinRpcConfig, BlockchainInfo, RawTransaction } from './rpc';

export type AddressType = 'legacy' | 'p2sh-segwit' | 'bech32';

export interface NodeClientConfig {
  user: string;
  password: string;
  walletPassword: string;
  allowUnconfirmedUtxos?: boolean;
}

export interface InWalletTransaction {
  txid: string;
  blockhash?: string;
  confirmations: number;
  time: number;
  amount: number;
  fee?: number;
}

export interface Block {
  hash: string;
  confirmations: number;
  height: number;
  time: number;
  tx: string[];
}

export enum NodeCommand {
  UNLOCK = 'walletpassphrase',
  SEND_UTXO = 'sendutxosfrom',
  SEND = 'send',
  TEST_MEMPOOL_ACCEPT = 'testmempoolaccept',
  SEND_RAW_TRANSACTION = 'sendrawtransaction',
  LIST_ADDRESS_GROUPINGS = 'listaddressgroupings',
}

export abstract class NodeClient extends BlockchainClient {
  private readonly logger = new DfxLogger(NodeClient);

  protected readonly rpc: BitcoinRpcClient;
  private readonly queue: QueueHandler;
  protected readonly nodeConfig: NodeClientConfig;

  constructor(http: HttpService, url: string, config: NodeClientConfig) {
    super();

    this.nodeConfig = config;

    const rpcConfig: BitcoinRpcConfig = {
      url,
      username: this.nodeConfig.user,
      password: this.nodeConfig.password,
    };

    this.rpc = new BitcoinRpcClient(http, rpcConfig);
    this.queue = new QueueHandler(180000, 60000);
  }

  clearRequestQueue(): void {
    this.queue.clear();
  }

  // --- BLOCKCHAIN METHODS --- //

  async getBlockCount(): Promise<number> {
    return this.callNode(() => this.rpc.getBlockCount());
  }

  async getInfo(): Promise<BlockchainInfo> {
    return this.callNode(() => this.rpc.getBlockchainInfo());
  }

  async checkSync(): Promise<{ headers: number; blocks: number }> {
    const info = await this.getInfo();

    if (info.blocks < info.headers - 1) {
      throw new Error(`Node not in sync by ${info.headers - info.blocks} block(s)`);
    }

    return { headers: info.headers, blocks: info.blocks };
  }

  async getBlock(hash: string): Promise<Block> {
    return this.callNode(() => this.rpc.getBlock(hash, 1));
  }

  async getBlockHash(height: number): Promise<string> {
    return this.callNode(() => this.rpc.getBlockHash(height));
  }

  // --- TRANSACTION METHODS --- //

  async waitForTx(txId: string, timeout = 600000): Promise<InWalletTransaction> {
    const tx = await Util.poll(
      () => this.getTx(txId),
      (t) => t != null && t.confirmations > 0,
      5000,
      timeout,
    );

    if (tx == null || !(tx.confirmations > 0)) {
      throw new ServiceUnavailableException('Wait for TX timed out');
    }

    return tx;
  }

  async getTx(txId: string): Promise<InWalletTransaction | null> {
    try {
      const tx = await this.callNode(() => this.rpc.getTransaction(txId), true);

      return {
        txid: tx.txid,
        blockhash: tx.blockhash,
        confirmations: tx.confirmations ?? 0,
        time: tx.time ?? 0,
        amount: tx.amount ?? 0,
        fee: tx.fee,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get raw transaction using getrawtransaction RPC.
   * Works for ALL transactions, not just wallet transactions.
   * Requires txindex=1 on the node for non-wallet transactions.
   *
   * @param txId - Transaction ID
   * @returns Raw transaction data or null if not found
   */
  async getRawTx(txId: string): Promise<RawTransaction | null> {
    try {
      const result = await this.callNode(() => this.rpc.getRawTransaction(txId, 2));
      return result as RawTransaction | null;
    } catch {
      return null;
    }
  }

  // --- WALLET METHODS --- //

  async createAddress(label: string, type: AddressType = 'bech32'): Promise<string> {
    return this.callNode(() => this.rpc.getNewAddress(label, type), true);
  }

  async getUtxo(includeUnconfirmed = false): Promise<UTXO[]> {
    const minConf = includeUnconfirmed ? 0 : 1;
    return this.callNode(() => this.rpc.listUnspent(minConf), true);
  }

  async getBalance(): Promise<number> {
    // Include unconfirmed UTXOs when configured
    // Bitcoin Core's getbalances returns: trusted (confirmed + own unconfirmed), untrusted_pending (others' unconfirmed), immature (coinbase)
    const balances = await this.callNode(() => this.rpc.getBalances(), true);
    if (balances?.mine == null) {
      throw new Error('Failed to get wallet balances');
    }
    // Return confirmed + unconfirmed balances when allowUnconfirmedUtxos is enabled
    const baseBalance = balances.mine.trusted;
    const unconfirmedBalance = this.nodeConfig.allowUnconfirmedUtxos ? balances.mine.untrusted_pending : 0;
    return baseBalance + unconfirmedBalance;
  }

  async sendUtxoToMany(payload: { addressTo: string; amount: number }[]): Promise<string> {
    if (payload.length > 100) {
      throw new Error('Too many addresses in one transaction batch, allowed max 100 for UTXO');
    }

    const amounts = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: p.amount }), {});
    return this.callNode(() => this.rpc.sendMany('', amounts), true);
  }

  // --- FEE ESTIMATION METHODS --- //

  async estimateSmartFee(confTarget = 1): Promise<number | null> {
    const result = await this.callNode(() => this.rpc.estimateSmartFee(confTarget));

    // Returns fee rate in BTC/kvB, convert to sat/vB
    // Note: Bitcoin Core returns feerate: -1 when insufficient data
    if (result?.feerate && result.feerate > 0) {
      return result.feerate * 100000; // BTC/kvB → sat/vB
    }
    return null;
  }

  async getMempoolEntry(txid: string): Promise<{ feeRate: number; vsize: number } | null> {
    try {
      const result = await this.callNode(() => this.rpc.getMempoolEntry(txid));

      if (result?.fees?.base && result?.vsize) {
        // fees.base is in BTC, vsize is in vBytes
        // feeRate = (fees.base * 100_000_000) / vsize = sat/vB
        const feeRate = (result.fees.base * 100000000) / result.vsize;
        return { feeRate, vsize: result.vsize };
      }
      return null;
    } catch {
      // TX not in mempool (already confirmed or doesn't exist)
      return null;
    }
  }

  // --- FORWARDING METHODS --- //

  async sendRpcCommand(command: string): Promise<any> {
    return this.rpc.rawPost(command);
  }

  async sendCliCommand(command: string, noAutoUnlock?: boolean): Promise<any> {
    const cmdParts = command.split(' ');
    const method = cmdParts.shift() as string;
    const params = cmdParts.map((p) => JSON.parse(p));

    return this.callNode(() => this.rpc.call(method, params), !noAutoUnlock);
  }

  // --- UTILITY METHODS --- //

  parseAmount(amount: string): { amount: number; asset: string } {
    return {
      amount: +amount.split('@')[0],
      asset: amount.split('@')[1],
    };
  }

  // --- HELPER METHODS --- //

  protected async callNode<T>(call: () => Promise<T>, unlock = false): Promise<T> {
    try {
      if (unlock) {
        await this.unlock();
      }

      return await this.callWithRetry(call);
    } catch (e) {
      this.logger.verbose('Exception during node call:', e);
      throw e;
    }
  }

  private async callWithRetry<T>(call: () => Promise<T>, tryCount = 3): Promise<T> {
    try {
      return await this.queue.handle(call);
    } catch (e) {
      if (e instanceof SyntaxError && tryCount > 1) {
        this.logger.verbose('Retrying node call ...');
        return this.callWithRetry(call, tryCount - 1);
      }
      throw e;
    }
  }

  private async unlock(timeout = 60): Promise<void> {
    try {
      await this.rpc.walletPassphrase(this.nodeConfig.walletPassword, timeout);
    } catch (e) {
      this.logger.verbose('Wallet unlock attempt:', e.message);
    }
  }

  protected roundAmount(amount: number): number {
    return Util.round(amount, 8);
  }
}
