import { Currency } from '@uniswap/sdk-core';
import { Agent } from 'https';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { EvmSignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { BlockchainClient } from '../shared/util/blockchain-client';
import {
  AddressResultDto,
  GetAddressResultDto,
  GetBalanceResultDto,
  GetFeeEstimateResultDto,
  GetInfoResultDto,
  GetSendTransferResultDto,
  GetTransactionResultDto,
  GetTransfersResultDto,
  MoneroTransactionDto,
  MoneroTransactionType,
  MoneroTransferDto,
  VerifyResultDto,
} from './dto/monero.dto';
import { MoneroHelper } from './monero-helper';

export class MoneroClient extends BlockchainClient {
  constructor(private readonly http: HttpService) {
    super();
  }

  // --- MONERO DAEMON --- //

  async getInfo(): Promise<GetInfoResultDto> {
    return this.http
      .post<{ result: GetInfoResultDto }>(
        `${Config.blockchain.monero.node.url}/json_rpc`,
        {
          method: 'get_info',
          params: { account_index: 0 },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  async getBlockHeight(): Promise<number> {
    return this.http
      .post<{ height: number }>(`${Config.blockchain.monero.node.url}/get_height`, {}, this.httpConfig())
      .then((r) => r.height);
  }

  async getFeeEstimate(): Promise<GetFeeEstimateResultDto> {
    return this.http
      .post<{ result: GetFeeEstimateResultDto }>(
        `${Config.blockchain.monero.node.url}/json_rpc`,
        {
          method: 'get_fee_estimate',
          params: {},
        },
        this.httpConfig(),
      )
      .then((r) => this.convertFeeEstimateAuToXmr(r.result));
  }

  // --- UNIMPLEMENTED METHODS --- //

  async getToken(_: Asset): Promise<Currency> {
    throw new Error('Monero has no token');
  }

  async getTokenBalance(_: Asset, __?: string): Promise<number> {
    throw new Error('Monero has no token');
  }

  async getTokenBalances(_: Asset[], __?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Monero has no token');
  }

  async sendSignedTransaction(_: string): Promise<EvmSignedTransactionResponse> {
    throw new Error('Method not implemented');
  }

  // --- PRIVATE HELPER METHODS --- //

  async isTxComplete(txId: string, confirmations?: number): Promise<boolean> {
    const transaction = await this.getTransaction(txId);
    return MoneroHelper.isTransactionComplete(transaction, confirmations);
  }

  private convertFeeEstimateAuToXmr(feeEstimateResult: GetFeeEstimateResultDto): GetFeeEstimateResultDto {
    feeEstimateResult.fee = MoneroHelper.auToXmr(feeEstimateResult.fee) ?? 0;
    feeEstimateResult.fees = feeEstimateResult.fees.map((fee) => MoneroHelper.auToXmr(fee) ?? 0);

    return feeEstimateResult;
  }

  async getTransaction(txId: string): Promise<MoneroTransactionDto | undefined> {
    return this.http
      .post<{ status: string; txs: GetTransactionResultDto[] }>(
        `${Config.blockchain.monero.node.url}/get_transactions`,
        {
          txs_hashes: [txId],
          decode_as_json: true,
        },
        this.httpConfig(),
      )
      .then((r) => this.mapTransaction(r.status, r.txs));
  }

  private mapTransaction(status: string, txs?: GetTransactionResultDto[]): MoneroTransactionDto {
    if ('OK' !== status || !txs) return {};

    const transactionResult = txs[0];

    const txnAsJson = transactionResult.as_json;
    const transaction = <MoneroTransactionDto>JSON.parse(txnAsJson);

    transaction.block_height = transactionResult.block_height;
    transaction.block_timestamp = transactionResult.block_timestamp;
    transaction.confirmations = transactionResult.confirmations;
    transaction.tx_hash = transactionResult.tx_hash;

    transaction.txnFee = MoneroHelper.auToXmr(this.mapTransactionFee(transaction)) ?? 0;

    return transaction;
  }

  private mapTransactionFee(transaction: MoneroTransactionDto): number {
    const vinAmounts = transaction.vin?.map((vin) => vin.key.amount) ?? [0];
    const voutAmounts = transaction.vout?.map((vout) => vout.amount) ?? [0];

    const totalVinAmount = Util.sum(vinAmounts);
    const totalVoutAmount = Util.sum(voutAmounts);

    transaction.inAmount = MoneroHelper.auToXmr(totalVinAmount) ?? 0;
    transaction.outAmount = MoneroHelper.auToXmr(totalVoutAmount) ?? 0;

    const transactionFee = totalVinAmount - totalVoutAmount;
    if (transactionFee > 0) return transactionFee;

    return transaction.rct_signatures?.txnFee ?? 0;
  }

  // --- MONERO WALLET --- //

  async verifySignature(message: string, address: string, signature: string): Promise<VerifyResultDto> {
    return this.http
      .post<{ result: VerifyResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'verify',
          params: { data: message, address: address, signature: signature },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  async createAddress(label?: string): Promise<AddressResultDto> {
    return this.http
      .post<{ result: AddressResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'create_address',
          params: {
            account_index: 0,
            label: label,
            count: 1,
          },
        },
        this.httpConfig(),
      )
      .then((r) => this.mapAddress(r.result, label));
  }

  private mapAddress(addressResult: AddressResultDto, label?: string): AddressResultDto {
    addressResult.label = label;
    addressResult.used = false;
    return addressResult;
  }

  async getAddresses(): Promise<AddressResultDto[]> {
    return this.http
      .post<{ result: GetAddressResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'get_address',
          params: {
            account_index: 0,
          },
        },
        this.httpConfig(),
      )
      .then((r) => r.result.addresses);
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance().then((b) => b.balance);
  }

  async getUnlockedBalance(): Promise<number> {
    return this.getBalance().then((b) => b.unlocked_balance);
  }

  private async getBalance(): Promise<GetBalanceResultDto> {
    return this.http
      .post<{ result: GetBalanceResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'get_balance',
          params: { account_index: 0 },
        },
        this.httpConfig(),
      )
      .then((r) => this.convertBalanceAuToXmr(r.result));
  }

  async getNativeCoinBalanceForAddress(_: string): Promise<number> {
    throw new Error('Coin balance for address not possible for monero');
  }

  private convertBalanceAuToXmr(balanceResultDto: GetBalanceResultDto): GetBalanceResultDto {
    balanceResultDto.balance = MoneroHelper.auToXmr(balanceResultDto.balance) ?? 0;
    balanceResultDto.unlocked_balance = MoneroHelper.auToXmr(balanceResultDto.unlocked_balance) ?? 0;

    return balanceResultDto;
  }

  async sendTransfer(destinationAddress: string, amount: number): Promise<MoneroTransferDto> {
    return this.sendTransfers([{ addressTo: destinationAddress, amount }]);
  }

  async sendTransfers(payout: PayoutGroup): Promise<MoneroTransferDto> {
    return this.http
      .post<GetSendTransferResultDto>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'transfer',
          params: {
            destinations: payout.map((p) => ({ address: p.addressTo, amount: MoneroHelper.xmrToAu(p.amount) })),
            account_index: 0,
            priority: 0,
          },
        },
        this.httpConfig(),
      )
      .then((r) => this.mapSendTransfer(r));
  }

  private mapSendTransfer(sendTransferResult: GetSendTransferResultDto): MoneroTransferDto {
    if (sendTransferResult.error) throw new Error(sendTransferResult.error.message);
    if (!sendTransferResult.result) throw new Error('No result after send transfer');

    return this.convertTransferAuToXmr({
      amount: sendTransferResult.result.amount,
      fee: sendTransferResult.result.fee,
      txid: sendTransferResult.result.tx_hash,
    });
  }

  async getTransfers(type: MoneroTransactionType, blockHeight: number): Promise<MoneroTransferDto[]> {
    const transfers = await this.http
      .post<{ result: GetTransfersResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'get_transfers',
          params: {
            [type]: true,
            filter_by_height: true,
            min_height: blockHeight,
          },
        },
        this.httpConfig(),
      )
      .then((r) => r.result[type]?.map((t) => this.convertTransferAuToXmr(t)) ?? []);

    return this.sortTransfers(transfers);
  }

  private sortTransfers(transfers: MoneroTransferDto[]): MoneroTransferDto[] {
    return Util.sort(transfers, 'timestamp', 'DESC');
  }

  private convertTransferAuToXmr(transfer: MoneroTransferDto): MoneroTransferDto {
    transfer.amount = MoneroHelper.auToXmr(transfer.amount) ?? 0;
    transfer.fee = MoneroHelper.auToXmr(transfer.fee) ?? 0;

    transfer.destinations?.forEach((d) => (d.amount = MoneroHelper.auToXmr(d.amount) ?? 0));

    return transfer;
  }

  // --- HELPER --- //

  private httpConfig(): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: Config.blockchain.monero.certificate,
      }),
    };
  }
}
