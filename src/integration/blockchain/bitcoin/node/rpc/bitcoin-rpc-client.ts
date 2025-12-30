/**
 * Minimal Bitcoin Core RPC Client
 *
 * A lightweight, fully-typed Bitcoin Core JSON-RPC client using positional parameters.
 * Inspired by bitcoin-simple-rpc but with full TypeScript support.
 *
 * Key features:
 * - Uses positional parameters (arrays) for maximum compatibility
 * - Full TypeScript type definitions
 * - Only implements methods needed by DFX (~15 methods)
 * - No external dependencies beyond axios/http
 */

import { HttpService } from 'src/shared/services/http.service';
import {
  AddressType,
  BitcoinRpcConfig,
  Block,
  BlockchainInfo,
  MempoolEntry,
  RpcResponse,
  SendResult,
  SmartFeeResult,
  TestMempoolAcceptResult,
  TransactionHistoryEntry,
  UTXO,
  WalletInfo,
  WalletTransaction,
} from './bitcoin-rpc-types';

export class BitcoinRpcClient {
  private readonly authHeader: string;
  private readonly url: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: BitcoinRpcConfig,
  ) {
    this.url = `http://${config.host}:${config.port}`;
    this.authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  // --- Core RPC Method --- //

  /**
   * Make an RPC call with positional parameters (array).
   * This is the core method that all other methods use.
   * Public to allow custom RPC calls from NodeClient.sendCliCommand.
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const body = {
      jsonrpc: '1.0',
      id: `btc-rpc-${Date.now()}`,
      method,
      params,
    };

    const response = await this.http.post<RpcResponse<T>>(this.url, JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
      },
    });

    if (response.error) {
      const error = new Error(response.error.message) as Error & { code: number };
      error.code = response.error.code;
      throw error;
    }

    return response.result;
  }

  // --- Blockchain Methods --- //

  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return this.call<BlockchainInfo>('getblockchaininfo');
  }

  async getBlockCount(): Promise<number> {
    return this.call<number>('getblockcount');
  }

  async getBlockHash(height: number): Promise<string> {
    return this.call<string>('getblockhash', [height]);
  }

  async getBlock(blockhash: string, verbosity: 0 | 1 | 2 = 1): Promise<Block> {
    return this.call<Block>('getblock', [blockhash, verbosity]);
  }

  // --- Transaction Methods --- //

  async getTransaction(txid: string, includeWatchonly = true): Promise<WalletTransaction> {
    return this.call<WalletTransaction>('gettransaction', [txid, includeWatchonly]);
  }

  async sendRawTransaction(hexstring: string, maxfeerate?: number): Promise<string> {
    const params: unknown[] = [hexstring];
    if (maxfeerate !== undefined) params.push(maxfeerate);
    return this.call<string>('sendrawtransaction', params);
  }

  async testMempoolAccept(rawtxs: string[], maxfeerate?: number): Promise<TestMempoolAcceptResult[]> {
    const params: unknown[] = [rawtxs];
    if (maxfeerate !== undefined) params.push(maxfeerate);
    return this.call<TestMempoolAcceptResult[]>('testmempoolaccept', params);
  }

  async getMempoolEntry(txid: string): Promise<MempoolEntry> {
    return this.call<MempoolEntry>('getmempoolentry', [txid]);
  }

  // --- Wallet Methods --- //

  async getNewAddress(label = '', addressType: AddressType = 'bech32'): Promise<string> {
    return this.call<string>('getnewaddress', [label, addressType]);
  }

  async listUnspent(minconf = 1, maxconf = 9999999, addresses?: string[]): Promise<UTXO[]> {
    const params: unknown[] = [minconf, maxconf];
    if (addresses) params.push(addresses);
    return this.call<UTXO[]>('listunspent', params);
  }

  async listWallets(): Promise<string[]> {
    return this.call<string[]>('listwallets');
  }

  async getWalletInfo(): Promise<WalletInfo> {
    return this.call<WalletInfo>('getwalletinfo');
  }

  async listTransactions(label = '*', count = 10, skip = 0, includeWatchonly = true): Promise<TransactionHistoryEntry[]> {
    return this.call<TransactionHistoryEntry[]>('listtransactions', [label, count, skip, includeWatchonly]);
  }

  async listAddressGroupings(): Promise<unknown[][][]> {
    return this.call<unknown[][][]>('listaddressgroupings');
  }

  async walletPassphrase(passphrase: string, timeout: number): Promise<void> {
    await this.call<null>('walletpassphrase', [passphrase, timeout]);
  }

  /**
   * Send bitcoin to multiple addresses.
   * @param outputs - Array of {address: amount} objects or object with addresses as keys
   * @param confTarget - Confirmation target for fee estimation (optional)
   * @param estimateMode - Fee estimate mode: "unset", "economical", "conservative" (optional)
   * @param feeRate - Fee rate in sat/vB (optional, overrides confTarget)
   * @param options - Additional options like change_address, replaceable, etc.
   */
  async send(
    outputs: Record<string, number>[] | Record<string, number>,
    confTarget?: number | null,
    estimateMode?: string | null,
    feeRate?: number | null,
    options?: {
      inputs?: Array<{ txid: string; vout: number }>;
      change_address?: string;
      replaceable?: boolean;
      locktime?: number;
    },
  ): Promise<SendResult> {
    const params: unknown[] = [outputs];

    // Add optional parameters in order
    params.push(confTarget ?? null);
    params.push(estimateMode ?? null);
    params.push(feeRate ?? null);

    if (options) {
      params.push(options);
    }

    return this.call<SendResult>('send', params);
  }

  /**
   * Send to multiple addresses using sendmany (for backwards compatibility).
   */
  async sendMany(
    dummy: string,
    amounts: Record<string, number>,
    minconf = 1,
    comment = '',
    subtractfeefrom: string[] = [],
    replaceable = false,
    confTarget?: number,
    estimateMode: 'unset' | 'economical' | 'conservative' = 'unset',
  ): Promise<string> {
    return this.call<string>('sendmany', [
      dummy,
      amounts,
      minconf,
      comment,
      subtractfeefrom,
      replaceable,
      confTarget,
      estimateMode,
    ]);
  }

  // --- Fee Estimation Methods --- //

  async estimateSmartFee(confTarget: number, estimateMode: 'unset' | 'economical' | 'conservative' = 'unset'): Promise<SmartFeeResult> {
    return this.call<SmartFeeResult>('estimatesmartfee', [confTarget, estimateMode]);
  }

  // --- Utility Methods --- //

  /**
   * Send a raw RPC command (for legacy compatibility).
   */
  async rawPost<T>(command: string): Promise<T> {
    return this.http.post<T>(this.url, command, {
      headers: {
        'Content-Type': 'text/plain',
        Authorization: this.authHeader,
      },
    });
  }

  /**
   * Get the RPC URL.
   */
  getUrl(): string {
    return this.url;
  }
}
