import { BitcoinRPC, BlockchainInfo } from '@btc-vision/bitcoin-rpc';
import { RPCConfig } from '@btc-vision/bitcoin-rpc/build/rpc/interfaces/RPCConfig.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { BlockchainClient } from '../../shared/util/blockchain-client';
import { UTXO } from './dto/bitcoin-transaction.dto';

export type AddressType = 'legacy' | 'p2sh-segwit' | 'bech32';

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

export interface WalletInfo {
  walletname: string;
  balance: number;
  unconfirmed_balance: number;
  immature_balance: number;
  txcount: number;
}

export { BlockchainInfo };

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

  protected readonly rpc: BitcoinRPC;
  private readonly queue: QueueHandler;
  private initialized = false;
  private readonly rpcConfig: RPCConfig;

  constructor(
    private readonly http: HttpService,
    private readonly url: string,
  ) {
    super();

    this.rpcConfig = this.parseRpcUrl(url);
    this.rpc = new BitcoinRPC(300000, false); // 5min cache, no debug
    this.queue = new QueueHandler(180000, 60000);
  }

  private parseRpcUrl(url: string): RPCConfig {
    const parsed = new URL(url);
    return {
      BITCOIND_HOST: parsed.hostname,
      BITCOIND_PORT: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 8332),
      BITCOIND_USERNAME: Config.blockchain.default.user,
      BITCOIND_PASSWORD: Config.blockchain.default.password,
    };
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    await this.rpc.init(this.rpcConfig);
    this.initialized = true;
  }

  destroy(): void {
    this.rpc.destroy();
  }

  clearRequestQueue(): void {
    this.queue.clear();
  }

  // --- BLOCKCHAIN METHODS --- //

  async getBlockCount(): Promise<number> {
    // Positional parameters: getblockcount (no params)
    const count = await this.callNode<number>(() => this.callRpcWithPositionalParams<number>('getblockcount', []));
    if (count === null) throw new Error('Failed to get block count');
    return count;
  }

  async getInfo(): Promise<BlockchainInfo> {
    // Positional parameters: getblockchaininfo (no params)
    const info = await this.callNode(() => this.callRpcWithPositionalParams<BlockchainInfo>('getblockchaininfo', []));
    if (info === null) throw new Error('Failed to get chain info');
    return info;
  }

  async checkSync(): Promise<{ headers: number; blocks: number }> {
    const info = await this.getInfo();

    if (info.blocks < info.headers - 1) {
      throw new Error(`Node not in sync by ${info.headers - info.blocks} block(s)`);
    }

    return { headers: info.headers, blocks: info.blocks };
  }

  async getBlock(hash: string): Promise<Block> {
    const block = await this.callNode(async () => {
      // Use positional parameters: getblock "blockhash" verbosity
      return this.callRpcWithPositionalParams<Block>('getblock', [hash, 1]);
    });
    if (!block) throw new Error(`Failed to get block ${hash}`);
    return block;
  }

  async getBlockHash(height: number): Promise<string> {
    // Positional parameters: getblockhash height
    const hash = await this.callNode<string>(() => this.callRpcWithPositionalParams<string>('getblockhash', [height]));
    if (hash === null) throw new Error(`Failed to get block hash for height ${height}`);
    return hash;
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
      // Use wallet's gettransaction RPC to get fee and amount from wallet's perspective
      // Positional parameters: gettransaction "txid"
      const tx = await this.callNode(async () => {
        return this.callRpcWithPositionalParams<{
          txid: string;
          blockhash?: string;
          confirmations?: number;
          time?: number;
          amount?: number;
          fee?: number;
        }>('gettransaction', [txId]);
      }, true);

      if (!tx) return null;

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

  // --- WALLET METHODS --- //

  async createAddress(label: string, type: AddressType = 'bech32'): Promise<string> {
    // Positional parameters: getnewaddress "label" "address_type"
    const address = await this.callNode(async () => {
      return this.callRpcWithPositionalParams<string>('getnewaddress', [label, type]);
    }, true);
    if (address === null) throw new Error('Failed to create new address');
    return address;
  }

  async getUtxo(includeUnconfirmed = false): Promise<UTXO[]> {
    return this.callNode(async () => {
      const minConf = includeUnconfirmed ? 0 : 1;
      // Use positional parameters for maximum compatibility with Bitcoin Core versions
      const result = await this.callRpcWithPositionalParams<UTXO[]>('listunspent', [minConf]);
      return result ?? [];
    }, true);
  }

  async getBalance(): Promise<number> {
    // Positional parameters: listwallets (no params), getwalletinfo (no params for default wallet)
    const wallets = await this.callNode<string[]>(
      () => this.callRpcWithPositionalParams<string[]>('listwallets', []),
      true,
    );
    const walletName = wallets?.[0] ?? '';

    const walletInfo = await this.callNode<WalletInfo>(
      () => this.callRpcWithPositionalParams<WalletInfo>('getwalletinfo', []),
      true,
    );

    return walletInfo?.balance ?? 0;
  }

  async sendUtxoToMany(payload: { addressTo: string; amount: number }[]): Promise<string> {
    if (payload.length > 100) {
      throw new Error('Too many addresses in one transaction batch, allowed max 100 for UTXO');
    }

    // Use sendmany for better compatibility with older Bitcoin Core versions
    // Positional parameters: sendmany "" {"address":amount,...}
    const amounts = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: p.amount }), {});

    const result = await this.callNode<string>(
      () => this.callRpcWithPositionalParams<string>('sendmany', ['', amounts]),
      true,
    );

    return result ?? '';
  }

  // --- FEE ESTIMATION METHODS --- //

  async estimateSmartFee(confTarget = 1): Promise<number | null> {
    // Positional parameters: estimatesmartfee conf_target
    const result = await this.callNode(async () => {
      return this.callRpcWithPositionalParams<{ feerate?: number }>('estimatesmartfee', [confTarget]);
    });

    // Returns fee rate in BTC/kvB, convert to sat/vB
    // Note: Bitcoin Core returns feerate: -1 when insufficient data
    if (result?.feerate && result.feerate > 0) {
      return result.feerate * 100000; // BTC/kvB → sat/vB
    }
    return null;
  }

  async getMempoolEntry(txid: string): Promise<{ feeRate: number; vsize: number } | null> {
    try {
      // Positional parameters: getmempoolentry "txid"
      const result = await this.callNode(async () => {
        return this.callRpcWithPositionalParams<{ fees?: { base?: number }; vsize?: number }>(
          'getmempoolentry',
          [txid],
        );
      });

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
    return this.http.post(this.url, command, {
      headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
    });
  }

  async sendCliCommand(command: string, noAutoUnlock?: boolean): Promise<any> {
    const cmdParts = command.split(' ');
    const method = cmdParts.shift();
    const params = cmdParts.map((p) => JSON.parse(p));

    // Use positional parameters for CLI commands
    return this.callNode(async () => {
      return this.callRpcWithPositionalParams(method, params);
    }, !noAutoUnlock);
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
      await this.init();

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
      // Use positional parameters for maximum compatibility with Bitcoin Core versions
      await this.callRpcWithPositionalParams('walletpassphrase', [
        Config.blockchain.default.walletPassword,
        timeout,
      ]);
    } catch (e) {
      this.logger.verbose('Wallet unlock attempt:', e.message);
    }
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(
      `${Config.blockchain.default.user}:${Config.blockchain.default.password}`,
    ).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }

  /**
   * Make an RPC call using positional parameters (arrays) for maximum compatibility.
   * This is useful for Bitcoin Core versions that don't fully support named parameters.
   */
  protected async callRpcWithPositionalParams<T>(method: string, params: unknown[] = []): Promise<T | null> {
    const body = {
      method,
      params,
      jsonrpc: '1.0',
      id: 'rpc-bitcoin',
    };

    try {
      const response = await this.http.post<{ result: T; error: { message: string } | null }>(
        this.url,
        JSON.stringify(body),
        {
          headers: { ...this.createHeaders(), 'Content-Type': 'application/json' },
        },
      );

      if (response.error) {
        throw new Error(response.error.message);
      }

      return response.result;
    } catch (e) {
      this.logger.verbose(`RPC call ${method} failed:`, e);
      throw e;
    }
  }

  protected roundAmount(amount: number): number {
    return Util.round(amount, 8);
  }
}
