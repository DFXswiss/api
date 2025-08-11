import { Currency } from '@uniswap/sdk-core';
import { getKeysFromAddress } from '@zano-project/zano-utils-js';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { BlockchainClient } from '../shared/util/blockchain-client';
import {
  ZanoAddressDto,
  ZanoGetBalanceResultDto,
  ZanoGetTransactionResultDto,
  ZanoGetTransferEmployedEntryDto,
  ZanoGetTransferResultDto,
  ZanoSendTransferResultDto,
  ZanoTransactionDto,
  ZanoTransferDto,
  ZanoTransferReceiveDto,
} from './dto/zano.dto';
import { ZanoHelper } from './zano-helper';

export class ZanoClient extends BlockchainClient {
  constructor(private readonly http: HttpService) {
    super();
  }

  // --- ZANO DAEMON --- //

  async getInfo(): Promise<string> {
    const params = this.httpParams('getinfo', []);

    return this.http
      .post<{ result: { status: string } }>(`${Config.blockchain.zano.node.url}/json_rpc`, params)
      .then((r) => r.result.status);
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    const { spendPublicKey } = getKeysFromAddress(address);

    const params = this.httpParams('validate_signature', {
      buff: Buffer.from(message).toString('base64'),
      pkey: spendPublicKey,
      sig: signature,
    });

    return this.http
      .post<{ result: { status: string } }>(`${Config.blockchain.zano.node.url}/json_rpc`, params)
      .then((r) => r.result?.status === 'OK');
  }

  async getBlockHeight(): Promise<number> {
    return this.http.get<{ height: number }>(`${Config.blockchain.zano.node.url}/getheight`).then((r) => r.height - 1);
  }

  getFeeEstimate(): number {
    return Config.blockchain.zano.fee;
  }

  async getTransaction(txId: string): Promise<ZanoTransactionDto> {
    const params = this.httpParams('get_tx_details', {
      tx_hash: txId,
    });

    return this.http
      .post<{ result: { tx_info: ZanoGetTransactionResultDto } }>(`${Config.blockchain.zano.node.url}/json_rpc`, params)
      .then((r) => this.mapTransaction(r.result.tx_info));
  }

  private mapTransaction(tx: ZanoGetTransactionResultDto): ZanoTransactionDto {
    return {
      id: tx.id,
      block: tx.keeper_block,
      amount: ZanoHelper.auToZano(tx.amount),
      fee: ZanoHelper.auToZano(tx.fee),
      status: tx.status,
      timestamp: tx.timestamp,
    };
  }

  async isTxComplete(txId: string, confirmations = 0): Promise<boolean> {
    const blockHeight = await this.getBlockHeight();
    const transaction = await this.getTransaction(txId);
    if (!transaction) return false;

    return blockHeight - transaction.block > confirmations;
  }

  // --- ZANO WALLET --- //

  async getAddress(): Promise<ZanoAddressDto | undefined> {
    const params = this.httpParams('getaddress', []);

    return this.http
      .post<{ result: { address: string } }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => ({ address: r.result.address }));
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance().then((b) => b.balance);
  }

  async getUnlockedBalance(): Promise<number> {
    return this.getBalance().then((b) => b.unlocked_balance);
  }

  private async getBalance(): Promise<ZanoGetBalanceResultDto> {
    const params = this.httpParams('getbalance', []);

    return this.http
      .post<{ result: ZanoGetBalanceResultDto }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => this.convertBalanceAuToZano(r.result));
  }

  private convertBalanceAuToZano(balanceResultDto: ZanoGetBalanceResultDto): ZanoGetBalanceResultDto {
    balanceResultDto.balance = ZanoHelper.auToZano(balanceResultDto.balance) ?? 0;
    balanceResultDto.unlocked_balance = ZanoHelper.auToZano(balanceResultDto.unlocked_balance) ?? 0;

    return balanceResultDto;
  }

  async getNativeCoinBalanceForAddress(_: string): Promise<number> {
    throw new Error('Coin balance for address not possible for zano');
  }

  async signMessage(message: string): Promise<any> {
    const params = this.httpParams('sign_message', {
      buff: Buffer.from(message).toString('base64'),
    });

    return this.http.post<any>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params);
  }

  async sendTransfer(destinationAddress: string, amount: number): Promise<ZanoSendTransferResultDto> {
    return this.sendTransfers([{ addressTo: destinationAddress, amount }]);
  }

  async sendTransfers(payout: PayoutGroup): Promise<ZanoSendTransferResultDto> {
    const { unlocked_balance } = await this.getBalance();
    const payoutAmount = Util.round(Util.sum(payout.map((p) => p.amount)), ZanoHelper.ZANO_DECIMALS);
    const totalAmount = Util.round(payoutAmount + Config.blockchain.zano.fee, ZanoHelper.ZANO_DECIMALS);

    if (unlocked_balance < totalAmount)
      throw new Error(`Unlocked balance ${unlocked_balance} less than amount + fee ${totalAmount}`);

    const transferParams = this.httpParams('transfer', {
      destinations: payout.map((p) => ({
        address: p.addressTo,
        amount: ZanoHelper.zanoToAu(p.amount),
        asset_id: Config.blockchain.zano.coinId,
      })),
      fee: ZanoHelper.zanoToAu(Config.blockchain.zano.fee),
      hide_receiver: true,
      mixin: 15,
      payment_id: '',
      push_payer: false,
      service_entries: [],
    });

    return this.http
      .post<{ result: { tx_details: { tx_hash: string } } }>(
        `${Config.blockchain.zano.wallet.url}/json_rpc`,
        transferParams,
      )
      .then((r) => ({
        txId: r.result.tx_details.tx_hash,
        amount: payoutAmount,
        fee: Config.blockchain.zano.fee,
      }));
  }

  async getTransactionHistory(blockHeight: number): Promise<ZanoTransferDto[]> {
    const actualBlockHeight = await this.getBlockHeight();
    const count = actualBlockHeight - blockHeight;
    if (count <= 0) return [];

    const params = this.httpParams('get_recent_txs_and_info2', {
      count,
      exclude_mining_txs: true,
      exclude_unconfirmed: true,
      offset: 0,
      order: 'FROM_END_TO_BEGIN',
      update_provision_info: false,
    });

    return this.http
      .post<{ result: { transfers: ZanoGetTransferResultDto[] } }>(
        `${Config.blockchain.zano.wallet.url}/json_rpc`,
        params,
      )
      .then((r) => (r.result.transfers ? this.mapTransfer(r.result.transfers) : []));
  }

  private mapTransfer(transferResults: ZanoGetTransferResultDto[]): ZanoTransferDto[] {
    return transferResults.map((tr) => ({
      block: tr.height,
      txId: tr.tx_hash,
      txType: tr.tx_type,
      fee: ZanoHelper.auToZano(tr.fee),
      timestamp: tr.timestamp,
      receive: this.mapTransferEmployedEntry(tr.employed_entries.receive),
      spent: this.mapTransferEmployedEntry(tr.employed_entries.spent),
      paymentId: tr.payment_id !== '' ? tr.payment_id : undefined,
      accountIndex: tr.payment_id !== '' ? ZanoHelper.mapPaymentIdHexToIndex(tr.payment_id) : undefined,
    }));
  }

  private mapTransferEmployedEntry(
    transferEmployedEntry?: ZanoGetTransferEmployedEntryDto[],
  ): ZanoTransferReceiveDto[] | undefined {
    if (transferEmployedEntry)
      return transferEmployedEntry.map((r) => ({
        amount: ZanoHelper.auToZano(r.amount),
        assetId: r.asset_id,
      }));
  }

  // --- UNIMPLEMENTED METHODS --- //

  async getToken(_: Asset): Promise<Currency> {
    throw new Error('Zano has no token');
  }

  async getTokenBalance(_: Asset, __?: string): Promise<number> {
    throw new Error('Zano has no token');
  }

  async getTokenBalances(_: Asset[], __?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Zano has no token');
  }

  async sendSignedTransaction(_: string): Promise<SignedTransactionResponse> {
    throw new Error('Method not implemented');
  }

  // --- HELPER --- //

  private httpParams(method: string, params: any): any {
    return {
      id: 0,
      jsonrpc: '2.0',
      method,
      params,
    };
  }
}
