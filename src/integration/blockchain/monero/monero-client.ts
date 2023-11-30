import { Agent } from 'https';
import { Config } from 'src/config/config';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import {
  GetBalanceResultDto,
  GetFeeEstimateResultDto,
  GetInfoResultDto,
  GetTransactionResultDto,
  GetTransfersResultDto,
  TransferResultDto,
  VerifyResultDto,
} from './dto/monero.dto';
import { MoneroHelper } from './monero-helper';

export class MoneroClient {
  constructor(private readonly http: HttpService) {}

  // --- MONERO DAEMON --- //

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
      .then((r) => r.result);
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
      .then((r) => r.result);
  }

  async getTransaction(txId: string, decodeAsJson = false): Promise<GetTransactionResultDto> {
    return this.http
      .post<{ result: GetTransactionResultDto }>(
        `${Config.blockchain.monero.d.url}/get_transactions`,
        {
          params: { txs_hashes: [txId], decode_as_json: decodeAsJson },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  // --- MONERO RPC --- //

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

  async getInfo(): Promise<GetInfoResultDto> {
    return this.http
      .post<{ result: GetInfoResultDto }>(
        `${Config.blockchain.monero.rpc.url}`,
        {
          method: 'get_info',
          params: { account_index: 0 },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
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
