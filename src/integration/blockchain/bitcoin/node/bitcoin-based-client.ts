import { Currency } from '@uniswap/sdk-core';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainTokenBalance } from '../../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../../shared/dto/signed-transaction-reponse.dto';
import { TxBroadcastError, toBroadcastBoundaryError } from '../../shared/errors/tx-broadcast.error';
import { CoinOnly } from '../../shared/util/blockchain-client';
import { NodeClient, NodeClientConfig } from './node-client';

const BITCOIN_PRE_BROADCAST_RPC_CODES = [
  -6, // RPC_WALLET_INSUFFICIENT_FUNDS (Bitcoin Core src/rpc/protocol.h)
  -13, // RPC_WALLET_UNLOCK_NEEDED (Bitcoin Core src/rpc/protocol.h)
  -28, // RPC_IN_WARMUP (Bitcoin Core src/rpc/protocol.h) — NodeNotReadyError carries this code; request never executes
];

export interface TransactionHistory {
  address: string;
  category: string;
  blocktime: number;
  txid: string;
  confirmations: number;
  amount: number;
}

export interface TestMempoolResult {
  txid: string;
  allowed: boolean;
  vsize: number;
  fees: {
    base: number;
  };
  'reject-reason': string;
}

export abstract class BitcoinBasedClient extends NodeClient implements CoinOnly {
  constructor(http: HttpService, url: string, config: NodeClientConfig) {
    super(http, url, config);
  }

  abstract get walletAddress(): string;

  async send(
    addressTo: string,
    txId: string,
    amount: number,
    vout: number,
    feeRate: number,
  ): Promise<{ outTxId: string; feeAmount: number }> {
    // 135 vByte for a single-input single-output TX
    const feeAmount = (feeRate * 135) / Math.pow(10, 8);

    const outputs = [{ [addressTo]: this.roundAmount(amount - feeAmount) }];
    const options = {
      inputs: [{ txid: txId, vout }],
      replaceable: true,
    };

    // Broadcast boundary: Bitcoin Core's `send` RPC builds, signs and broadcasts atomically.
    // Connection-establishment failures and the protocol.h pre-funding codes stay plain; parsed
    // RPC errors are deterministic even over HTTP 500, while ambiguous transport failures fail closed.
    try {
      const result = await this.callNode(() => this.rpc.send(outputs, null, null, feeRate, options), true);
      if (!result?.txid) {
        throw new TxBroadcastError('Bitcoin broadcast returned an empty txid', { cause: result });
      }

      return { outTxId: result.txid, feeAmount };
    } catch (e) {
      throw toBroadcastBoundaryError(e, BITCOIN_PRE_BROADCAST_RPC_CODES);
    }
  }

  async sendMany(
    payload: { addressTo: string; amount: number }[],
    feeRate: number,
    inputs?: Array<{ txid: string; vout: number }>,
    subtractFeeFromOutputs?: number[],
  ): Promise<string> {
    const outputs = payload.map((p) => ({ [p.addressTo]: p.amount }));

    const options = {
      replaceable: true,
      change_address: this.walletAddress,
      ...(this.nodeConfig.allowUnconfirmedUtxos && { include_unsafe: true }),
      ...(inputs && { inputs, add_inputs: false }),
      ...(subtractFeeFromOutputs && { subtract_fee_from_outputs: subtractFeeFromOutputs }),
    };

    // Broadcast boundary: Bitcoin Core's `send` RPC builds, signs and broadcasts atomically.
    // Connection-establishment failures and the protocol.h pre-funding codes stay plain; parsed
    // RPC errors are deterministic even over HTTP 500, while ambiguous transport failures fail closed.
    // An empty/missing txid on a resolved response is equally ambiguous and must stay fail-closed
    // (not return '' which would later roll the payout order back for re-broadcast).
    try {
      const result = await this.callNode(() => this.rpc.send(outputs, null, null, feeRate, options), true);
      if (!result?.txid) {
        throw new TxBroadcastError('Bitcoin broadcast returned an empty txid', { cause: result });
      }
      return result.txid;
    } catch (e) {
      throw toBroadcastBoundaryError(e, BITCOIN_PRE_BROADCAST_RPC_CODES);
    }
  }

  async sendManyFromAddress(
    fromAddresses: string[],
    payload: { addressTo: string; amount: number }[],
    feeRate: number,
    subtractFeeFromOutputs?: number[],
  ): Promise<string> {
    const utxos = await this.getUtxoForAddresses(fromAddresses, this.nodeConfig.allowUnconfirmedUtxos);
    if (!utxos.length) throw new Error('No UTXOs available');

    const inputs = utxos.map((u) => ({ txid: u.txid, vout: u.vout }));
    const utxoBalance = utxos.reduce((sum, u) => sum + u.amount, 0);

    // resolve zero-amount entries with full UTXO balance (sweep mode)
    const resolvedPayload = payload.map((p) => ({ addressTo: p.addressTo, amount: p.amount || utxoBalance }));

    return this.sendMany(resolvedPayload, feeRate, inputs, subtractFeeFromOutputs);
  }

  async testMempoolAccept(hex: string): Promise<TestMempoolResult[]> {
    const result = await this.callNode(() => this.rpc.testMempoolAccept([hex]), true);

    if (!result || !Array.isArray(result)) {
      return [{ txid: '', allowed: false, vsize: 0, fees: { base: 0 }, 'reject-reason': 'RPC call failed' }];
    }

    return result.map((r) => ({
      txid: r.txid ?? '',
      allowed: r.allowed ?? false,
      vsize: r.vsize ?? 0,
      fees: { base: r.fees?.base ?? 0 },
      'reject-reason': r['reject-reason'] ?? '',
    }));
  }

  async sendSignedTransaction(hex: string): Promise<BlockchainSignedTransactionResponse> {
    try {
      const txid = await this.callNode(() => this.rpc.sendRawTransaction(hex), true);
      return { hash: txid ?? '' };
    } catch (e) {
      return {
        error: {
          code: e.code ?? -1,
          message: e.message ?? 'Unknown error',
        },
      };
    }
  }

  async getRecentHistory(txCount = 100): Promise<TransactionHistory[]> {
    const result = await this.callNode(() => this.rpc.listTransactions('*', txCount), true);
    return result.map((tx) => ({
      address: tx.address,
      category: tx.category,
      blocktime: tx.blocktime ?? 0,
      txid: tx.txid,
      confirmations: tx.confirmations,
      amount: tx.amount,
    }));
  }

  async isTxComplete(txId: string, minConfirmations?: number): Promise<boolean> {
    const transaction = await this.getTx(txId);
    return (
      transaction !== null &&
      transaction.blockhash !== undefined &&
      (transaction.confirmations ?? 0) > (minConfirmations ?? 0)
    );
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const groupings = await this.callNode(() => this.rpc.listAddressGroupings(), true);

    for (const outer of groupings) {
      for (const inner of outer) {
        if (inner[0] === address) {
          return inner[1] as number;
        }
      }
    }

    return 0;
  }

  // --- UNIMPLEMENTED METHODS (Bitcoin-based chains have no tokens) --- //
  async getToken(_: Asset): Promise<Currency> {
    throw new Error('Bitcoin chain has no token');
  }

  async getTokenBalance(_: Asset, __?: string): Promise<number> {
    throw new Error('Bitcoin chain has no token');
  }

  async getTokenBalances(_: Asset[], __?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Bitcoin chain has no token');
  }
}
