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
  Balances,
  BitcoinRpcConfig,
  Block,
  BlockchainInfo,
  MempoolEntry,
  RawTransaction,
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
    config: BitcoinRpcConfig,
  ) {
    this.url = config.url;
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

    let response: RpcResponse<T>;

    try {
      response = await this.http.post<RpcResponse<T>>(this.url, JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
      });
    } catch (e) {
      // Preserve SyntaxError for retry logic in NodeClient
      if (e instanceof SyntaxError) {
        throw e;
      }

      // Extract error details from Axios error response
      const axiosError = e as {
        response?: { status?: number; data?: RpcResponse<T> };
        message?: string;
        code?: number;
      };
      const rpcError = axiosError.response?.data?.error;

      if (rpcError) {
        const error = new Error(`Bitcoin RPC ${method} failed: ${rpcError.message}`) as Error & { code: number };
        error.code = rpcError.code;
        throw error;
      }

      // Re-throw with more context, preserving error code if present
      const error = new Error(`Bitcoin RPC ${method} failed: ${axiosError.message ?? e}`) as Error & { code: number };
      if (axiosError.code !== undefined) {
        error.code = axiosError.code;
      } else if ((e as Error & { code?: number }).code !== undefined) {
        error.code = (e as Error & { code?: number }).code!;
      }
      throw error;
    }

    if (response.error) {
      const error = new Error(`Bitcoin RPC ${method} failed: ${response.error.message}`) as Error & { code: number };
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

  /**
   * Get raw transaction data.
   * Works for ALL transactions, not just wallet transactions.
   * Requires txindex=1 on the node for non-wallet transactions.
   *
   * @param txid - Transaction ID
   * @param verbosity - 0: hex string, 1: JSON object, 2: JSON with prevout info
   * @returns Raw transaction data or null if not found
   */
  async getRawTransaction(txid: string, verbosity: 0 | 1 | 2 = 1): Promise<RawTransaction | string | null> {
    try {
      if (verbosity === 0) {
        return await this.call<string>('getrawtransaction', [txid, verbosity]);
      }
      return await this.call<RawTransaction>('getrawtransaction', [txid, verbosity]);
    } catch (e) {
      // Error code -5 means "No such mempool or blockchain transaction"
      if ((e as Error & { code: number }).code === -5) {
        return null;
      }
      throw e;
    }
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

  async getBalances(): Promise<Balances> {
    return this.call<Balances>('getbalances');
  }

  async listTransactions(
    label = '*',
    count = 10,
    skip = 0,
    includeWatchonly = true,
  ): Promise<TransactionHistoryEntry[]> {
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
      include_unsafe?: boolean;
      add_inputs?: boolean;
      add_to_wallet?: boolean;
      change_position?: number;
      change_type?: string;
      conf_target?: number;
      estimate_mode?: string;
      fee_rate?: number;
      include_watching?: boolean;
      lock_unspents?: boolean;
      psbt?: boolean;
      subtract_fee_from_outputs?: number[];
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

  async estimateSmartFee(
    confTarget: number,
    estimateMode: 'unset' | 'economical' | 'conservative' = 'unset',
  ): Promise<SmartFeeResult> {
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
