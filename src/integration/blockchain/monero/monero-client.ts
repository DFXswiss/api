import { Agent } from 'https';
import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import {
  AddressResultDto,
  GetAddressResultDto,
  GetBalanceResultDto,
  GetFeeEstimateResultDto,
  GetInfoResultDto,
  GetTransactionResultDto,
  GetTransfersResultDto,
  MoneroTransactionDto,
  TransferResultDto,
  VerifyResultDto,
} from './dto/monero.dto';
import { MoneroHelper } from './monero-helper';

export class MoneroClient {
  constructor(private readonly http: HttpService) {}

  // --- MONERO DAEMON --- //

  async getInfo(): Promise<GetInfoResultDto> {
    return this.http
      .post<{ result: GetInfoResultDto }>(
        `${Config.blockchain.monero.d.url}/json_rpc`,
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
      .post<{ height: number }>(`${Config.blockchain.monero.d.url}/get_height`, {}, this.httpConfig())
      .then((r) => r.height);
  }

  async getFeeEstimate(): Promise<GetFeeEstimateResultDto> {
    return this.http
      .post<{ result: GetFeeEstimateResultDto }>(
        `${Config.blockchain.monero.d.url}/json_rpc`,
        {
          method: 'get_fee_estimate',
          params: {},
        },
        this.httpConfig(),
      )
      .then((r) => this.mapFeeEstimate(r.result));
  }

  private mapFeeEstimate(feeEstimateResult: GetFeeEstimateResultDto): GetFeeEstimateResultDto {
    feeEstimateResult.fee = MoneroHelper.auToXmr(feeEstimateResult.fee);
    feeEstimateResult.fees = feeEstimateResult.fees.map((fee) => MoneroHelper.auToXmr(fee));

    return feeEstimateResult;
  }

  async transfer(destinationAddress: string, amount: number): Promise<TransferResultDto> {
    return this.http
      .post<{ result: TransferResultDto }>(
        `${Config.blockchain.monero.d.url}/json_rpc`,
        {
          method: 'transfer',
          params: {
            destinations: [{ amount: MoneroHelper.xmrToAu(amount), address: destinationAddress }],
            account_index: 0,
            priority: 0,
          },
        },
        this.httpConfig(),
      )
      .then((r) => this.mapTransfer(r.result));
  }

  private mapTransfer(transferResult: TransferResultDto): TransferResultDto {
    transferResult.amount = MoneroHelper.auToXmr(transferResult.amount);
    transferResult.fee = MoneroHelper.auToXmr(transferResult.fee);

    return transferResult;
  }

  async getTransaction(txId: string): Promise<MoneroTransactionDto | undefined> {
    return this.http
      .post<{ status: string; txs: GetTransactionResultDto[] }>(
        `${Config.blockchain.monero.d.url}/get_transactions`,
        {
          txs_hashes: [txId],
          decode_as_json: true,
        },
        this.httpConfig(),
      )
      .then((r) => this.mapTransaction(r.status, r.txs));
  }

  mapTransaction(status: string, txs?: GetTransactionResultDto[]): MoneroTransactionDto {
    if ('OK' !== status || !txs) return {};

    const transactionResult = txs[0];

    const txnAsJson = transactionResult.as_json;
    const transaction = <MoneroTransactionDto>JSON.parse(txnAsJson);

    transaction.block_height = transactionResult.block_height;
    transaction.block_timestamp = transactionResult.block_timestamp;
    transaction.confirmations = transactionResult.confirmations;
    transaction.tx_hash = transactionResult.tx_hash;

    const vinAmounts = transaction.vin?.map((vin) => vin.key.amount) ?? [0];
    const voutAmounts = transaction.vout?.map((vout) => vout.amount) ?? [0];

    const totalVinAmount = Util.sum(vinAmounts);
    const totalVoutAmount = Util.sum(voutAmounts);

    transaction.inAmount = MoneroHelper.auToXmr(totalVinAmount);
    transaction.outAmount = MoneroHelper.auToXmr(totalVoutAmount);
    transaction.txnFee = MoneroHelper.auToXmr(totalVinAmount - totalVoutAmount);

    return transaction;
  }

  // --- MONERO WALLET --- //

  async verifySignature(message: string, address: string, signature: string): Promise<VerifyResultDto> {
    return this.http
      .post<{ result: VerifyResultDto }>(
        `${Config.blockchain.monero.rpc.url}`,
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
        `${Config.blockchain.monero.rpc.url}`,
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
        `${Config.blockchain.monero.rpc.url}`,
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

  async getBalance(): Promise<GetBalanceResultDto> {
    return this.http
      .post<{ result: GetBalanceResultDto }>(
        `${Config.blockchain.monero.rpc.url}`,
        {
          method: 'get_balance',
          params: { account_index: 0 },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  async getTransfers(blockHeight: number): Promise<GetTransfersResultDto> {
    return this.http
      .post<{ result: GetTransfersResultDto }>(
        `${Config.blockchain.monero.rpc.url}`,
        {
          method: 'get_transfers',
          params: { in: true, filter_by_height: true, min_height: blockHeight },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  // --- HELPER --- //

  private httpConfig(): HttpRequestConfig {
    return {
      httpsAgent: new Agent({
        ca: Config.blockchain.monero.rpc.certificate,
      }),
    };
  }
}
