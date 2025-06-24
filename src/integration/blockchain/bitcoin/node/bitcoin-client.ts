import { Currency } from '@uniswap/sdk-core';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainTokenBalance } from '../../shared/dto/blockchain-token-balance.dto';
import { BitcoinSignedTransactionResponse } from '../../shared/dto/signed-transaction-reponse.dto';
import { NodeClient, NodeCommand } from './node-client';

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

type AddressInfoOuterArray = AddressInfoInnerArray[];
type AddressInfoInnerArray = AddressInfoArray[];
type AddressInfoArray = [string, number, string];

export class BitcoinClient extends NodeClient {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, http: HttpService, url: string) {
    super(http, url);

    this.logger = this.dfxLogger.create(BitcoinClient);
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

    const sendUtxo = await this.callNode<{ txid: string }>(
      (c) =>
        c.call(
          NodeCommand.SEND,
          [
            [{ [addressTo]: this.roundAmount(amount - feeAmount) }],
            null,
            'unset',
            null,
            { fee_rate: feeRate, inputs: [{ txid: txId, vout: vout }], replaceable: true },
          ],
          'number',
        ),
      true,
    );

    return { outTxId: sendUtxo.txid, feeAmount };
  }

  async sendMany(payload: { addressTo: string; amount: number }[], feeRate: number): Promise<string> {
    const batch = payload.reduce((acc, p) => ({ ...acc, [p.addressTo]: `${p.amount}` }), {});

    return this.callNode<{ txid: string }>(
      (c) =>
        c.call(
          NodeCommand.SEND,
          [
            batch,
            null,
            'unset',
            null,
            { fee_rate: feeRate, replaceable: true, change_address: Config.blockchain.default.btcOutput.address },
          ],
          'number',
        ),
      true,
    ).then((r) => r.txid);
  }

  async testMempoolAccept(hex: string): Promise<TestMempoolResult[]> {
    return this.callNode<TestMempoolResult[]>(
      (c) => c.call(NodeCommand.TEST_MEMPOOL_ACCEPT, [[hex], null], 'number'),
      true,
    );
  }

  async sendSignedTransaction(hex: string): Promise<BitcoinSignedTransactionResponse> {
    return this.callNode<string>((c) => c.call(NodeCommand.SEND_RAW_TRANSACTION, [hex, null], 'number'), true)
      .then((r) => ({ hash: r }))
      .catch((e) => ({
        error: {
          code: e.code,
          message: e.message,
        },
      }));
  }

  async getRecentHistory(txCount = 100): Promise<TransactionHistory[]> {
    return this.callNode<TransactionHistory[]>((c) => c.call('listtransactions', ['*', txCount], 'number'), true);
  }

  async isTxComplete(txId: string, minConfirmations?: number): Promise<boolean> {
    const transaction = await this.getTx(txId);
    return transaction.blockhash && transaction.confirmations > minConfirmations;
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance().then((r) => r.toNumber());
  }

  // Note: This method only works for all addresses of our wallet
  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    const outer = await this.callNode<AddressInfoOuterArray>(
      (c) => c.call(NodeCommand.LIST_ADDRESS_GROUPINGS, [], 'number'),
      true,
    );

    return outer.find((o) => o.find((i) => i[0] === address))?.map((i) => i[1])[0] ?? 0;
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
