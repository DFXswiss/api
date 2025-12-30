import { Currency } from '@uniswap/sdk-core';
import type { SendResult } from '@btc-vision/bitcoin-rpc/build/rpc/types/NewMethods';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../../shared/dto/blockchain-token-balance.dto';
import { BlockchainSignedTransactionResponse } from '../../shared/dto/signed-transaction-reponse.dto';
import { NodeClient } from './node-client';

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

export class BitcoinClient extends NodeClient {
  get walletAddress(): string {
    return Config.blockchain.default.btcOutput.address;
  }

  async send(
    addressTo: string,
    txId: string,
    amount: number,
    vout: number,
    feeRate: number,
  ): Promise<{ outTxId: string; feeAmount: number }> {
    // 135 vByte for a single-input single-output TX
    const feeAmount = (feeRate * 135) / Math.pow(10, 8);

    // Use the 'send' RPC with positional parameters (Bitcoin Core 0.21.0+)
    // Positional parameters: send [{"address":amount},...] conf_target "estimate_mode" fee_rate options
    const outputs = [{ [addressTo]: this.roundAmount(amount - feeAmount) }];
    const options = {
      inputs: [{ txid: txId, vout }],
      replaceable: true,
    };

    const result = await this.callNode<SendResult>(
      () => this.callRpcWithPositionalParams<SendResult>('send', [outputs, null, null, feeRate, options]),
      true,
    );

    return { outTxId: result?.txid ?? '', feeAmount };
  }

  async sendMany(payload: { addressTo: string; amount: number }[], feeRate: number): Promise<string> {
    const outputs = payload.map((p) => ({ [p.addressTo]: p.amount }));

    // Use the 'send' RPC with positional parameters (Bitcoin Core 0.21.0+)
    const options = {
      replaceable: true,
      change_address: Config.blockchain.default.btcOutput.address,
    };

    const result = await this.callNode<SendResult>(
      () => this.callRpcWithPositionalParams<SendResult>('send', [outputs, null, null, feeRate, options]),
      true,
    );

    return result?.txid ?? '';
  }

  async testMempoolAccept(hex: string): Promise<TestMempoolResult[]> {
    // Positional parameters: testmempoolaccept ["rawtx",...]
    const result = await this.callNode(async () => {
      return this.callRpcWithPositionalParams<TestMempoolResult[]>('testmempoolaccept', [[hex]]);
    }, true);

    if (!result || !Array.isArray(result)) {
      return [{ txid: '', allowed: false, vsize: 0, fees: { base: 0 }, 'reject-reason': 'RPC call failed' }];
    }

    return result.map((r: any) => ({
      txid: r.txid ?? '',
      allowed: r.allowed ?? false,
      vsize: r.vsize ?? 0,
      fees: { base: r.fees?.base ?? 0 },
      'reject-reason': r['reject-reason'] ?? '',
    }));
  }

  async sendSignedTransaction(hex: string): Promise<BlockchainSignedTransactionResponse> {
    try {
      // Positional parameters: sendrawtransaction "hexstring"
      const txid = await this.callNode<string>(
        () => this.callRpcWithPositionalParams<string>('sendrawtransaction', [hex]),
        true,
      );
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
    // Positional parameters: listtransactions "label" count
    return this.callNode(async () => {
      const result = await this.callRpcWithPositionalParams<TransactionHistory[]>('listtransactions', ['*', txCount]);
      return result ?? [];
    }, true);
  }

  async isTxComplete(txId: string, minConfirmations?: number): Promise<boolean> {
    const transaction = await this.getTx(txId);
    return (
      transaction !== null && transaction.blockhash !== undefined && transaction.confirmations > (minConfirmations ?? 0)
    );
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance();
  }

  // Note: This method only works for all addresses of our wallet
  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    // Positional parameters: listaddressgroupings (no params)
    const result = await this.callNode(async () => {
      const groupings = await this.callRpcWithPositionalParams<unknown[][][]>('listaddressgroupings', []);
      return groupings ?? [];
    }, true);

    for (const outer of result) {
      for (const inner of outer) {
        if (inner[0] === address) {
          return inner[1] as number;
        }
      }
    }

    return 0;
  }

  // --- UNIMPLEMENTED METHODS --- //
  async getToken(_: Asset): Promise<Currency> {
    throw new Error('Bitcoin has no token');
  }

  async getTokenBalance(_: Asset, __?: string): Promise<number> {
    throw new Error('Bitcoin has no token');
  }

  async getTokenBalances(_: Asset[], __?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Bitcoin has no token');
  }
}
