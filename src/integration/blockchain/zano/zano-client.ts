import { getKeysFromAddress } from '@zano-project/zano-utils-js';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import { BlockchainClient, BlockchainToken } from '../shared/util/blockchain-client';
import {
  ZanoAddressDto,
  ZanoAssetInfoDto,
  ZanoAssetWhitelistResultDto,
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
  private readonly tokens = new AsyncCache<BlockchainToken>();

  constructor(private readonly http: HttpService) {
    super();
  }

  // --- ZANO DAEMON --- //

  get walletAddress(): string {
    return Config.blockchain.zano.wallet.address;
  }

  async getNodeInfo(): Promise<string> {
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

  async getNodeBlockHeight(): Promise<number> {
    return this.http.get<{ height: number }>(`${Config.blockchain.zano.node.url}/getheight`).then((r) => r.height - 1);
  }

  getFeeEstimate(): number {
    return Config.blockchain.zano.fee;
  }

  async getToken(asset: Asset): Promise<BlockchainToken> {
    return this.getTokenByAssetId(asset.chainId);
  }

  private async getTokenByAssetId(assetId: string): Promise<BlockchainToken> {
    return this.tokens.get(assetId, async () => {
      const params = this.httpParams('get_asset_info', {
        asset_id: assetId,
      });

      const assetInfo = await this.http
        .post<{ result: { asset_descriptor: ZanoAssetInfoDto } }>(`${Config.blockchain.zano.node.url}/json_rpc`, params)
        .then((r) => r.result.asset_descriptor);

      return new BlockchainToken(assetId, assetInfo.decimal_point);
    });
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
      amount: ZanoHelper.fromAuAmount(tx.amount),
      fee: ZanoHelper.fromAuAmount(tx.fee),
      status: tx.status,
      timestamp: tx.timestamp,
    };
  }

  async isTxComplete(txId: string, confirmations = 0): Promise<boolean> {
    const blockHeight = await this.getNodeBlockHeight();
    const transaction = await this.getTransaction(txId);
    if (!transaction) return false;

    return blockHeight - transaction.block > confirmations;
  }

  // --- ZANO WALLET --- //

  async getWalletBlockHeight(): Promise<number> {
    const params = this.httpParams('get_wallet_info', []);

    return this.http
      .post<{ result: { current_height: number } }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => r.result.current_height);
  }

  async getAddress(): Promise<ZanoAddressDto | undefined> {
    const params = this.httpParams('getaddress', []);

    return this.http
      .post<{ result: { address: string } }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => ({ address: r.result.address }));
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getCoinBalance().then((b) => b.balance);
  }

  async getUnlockedNativeCoinBalance(): Promise<number> {
    return this.getCoinBalance().then((b) => b.unlocked_balance);
  }

  private async getCoinBalance(): Promise<ZanoGetBalanceResultDto> {
    const params = this.httpParams('getbalance', []);

    return this.http
      .post<{ result: ZanoGetBalanceResultDto }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => this.convertNativeCoinBalanceAuToZano(r.result));
  }

  private convertNativeCoinBalanceAuToZano(balanceResultDto: ZanoGetBalanceResultDto): ZanoGetBalanceResultDto {
    balanceResultDto.balance = ZanoHelper.fromAuAmount(balanceResultDto.balance) ?? 0;
    balanceResultDto.unlocked_balance = ZanoHelper.fromAuAmount(balanceResultDto.unlocked_balance) ?? 0;

    return balanceResultDto;
  }

  async getNativeCoinBalanceForAddress(_: string): Promise<number> {
    throw new Error('Coin balance for address not possible for zano');
  }

  async getTokenBalance(asset: Asset): Promise<number> {
    const tokenBalances = await this.getTokenBalances([asset]);

    return tokenBalances[0]?.balance ?? 0;
  }

  async getUnlockedTokenBalance(asset: Asset): Promise<number> {
    const tokenBalances = await this.getTokenBalances([asset]);

    return tokenBalances[0]?.unlockedBalance ?? 0;
  }

  async getTokenBalances(assets: Asset[]): Promise<BlockchainTokenBalance[]> {
    const tokenBalances: BlockchainTokenBalance[] = [];

    const params = this.httpParams('getbalance', []);

    const balanceResult = await this.http
      .post<{ result: ZanoGetBalanceResultDto }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => r.result);

    for (const asset of assets) {
      const assetBalance = balanceResult.balances.find((b) =>
        Util.equalsIgnoreCase(b.asset_info.asset_id, asset.chainId),
      );

      if (assetBalance) {
        const balance = ZanoHelper.fromAuAmount(assetBalance.total, assetBalance.asset_info.decimal_point);
        const unlockedBalance = ZanoHelper.fromAuAmount(assetBalance.unlocked, assetBalance.asset_info.decimal_point);
        tokenBalances.push({ owner: this.walletAddress, contractAddress: asset.chainId, balance, unlockedBalance });
      }
    }

    return tokenBalances;
  }

  async getAssetWhitelist(): Promise<ZanoAssetWhitelistResultDto> {
    const params = this.httpParams('assets_whitelist_get', []);

    return this.http
      .post<{ result: ZanoAssetWhitelistResultDto }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => r.result);
  }

  async addAssetToWhitelist(assetId: string): Promise<ZanoAssetInfoDto> {
    const params = this.httpParams('assets_whitelist_add', {
      asset_id: assetId,
    });

    return this.http
      .post<{ result: { asset_descriptor: ZanoAssetInfoDto } }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => r.result.asset_descriptor);
  }

  async signMessage(message: string): Promise<string> {
    const params = this.httpParams('sign_message', {
      buff: Buffer.from(message).toString('base64'),
    });

    return this.http
      .post<{ result: { sig: string } }>(`${Config.blockchain.zano.wallet.url}/json_rpc`, params)
      .then((r) => r.result.sig);
  }

  async sendCoin(destinationAddress: string, amount: number): Promise<ZanoSendTransferResultDto> {
    return this.sendCoins([{ addressTo: destinationAddress, amount }]);
  }

  async sendCoins(payout: PayoutGroup): Promise<ZanoSendTransferResultDto> {
    const unlockedCoinBalance = await this.getUnlockedNativeCoinBalance();
    const payoutAmount = Util.round(Util.sum(payout.map((p) => p.amount)), ZanoHelper.ZANO_DECIMALS);
    const totalAmount = Util.round(payoutAmount + Config.blockchain.zano.fee, ZanoHelper.ZANO_DECIMALS);

    if (unlockedCoinBalance < totalAmount)
      throw new Error(`Unlocked coin balance ${unlockedCoinBalance} less than amount + fee ${totalAmount}`);

    return this.doSendTransfer(payout, payoutAmount, ZanoHelper.ZANO_DECIMALS, Config.blockchain.zano.coinId);
  }

  async sendToken(destinationAddress: string, amount: number, token: Asset): Promise<ZanoSendTransferResultDto> {
    return this.sendTokens([{ addressTo: destinationAddress, amount }], token);
  }

  async sendTokens(payout: PayoutGroup, token: Asset): Promise<ZanoSendTransferResultDto> {
    const unlockedCoinBalance = await this.getUnlockedNativeCoinBalance();
    if (unlockedCoinBalance < Config.blockchain.zano.fee)
      throw new Error(`Unlocked coin balance ${unlockedCoinBalance} less than fee ${Config.blockchain.zano.fee}`);

    const unlockedTokenBalance = await this.getUnlockedTokenBalance(token);
    const payoutAmount = Util.round(Util.sum(payout.map((p) => p.amount)), token.decimals);

    if (unlockedTokenBalance < payoutAmount)
      throw new Error(`Unlocked token balance ${unlockedTokenBalance} less than token amount ${payoutAmount}`);

    return this.doSendTransfer(payout, payoutAmount, token.decimals, token.chainId);
  }

  private async doSendTransfer(
    payout: PayoutGroup,
    payoutAmount: number,
    decimals: number,
    assetId: string,
  ): Promise<ZanoSendTransferResultDto> {
    const transferParams = this.httpParams('transfer', {
      destinations: payout.map((p) => ({
        address: p.addressTo,
        amount: ZanoHelper.toAuAmount(p.amount, decimals),
        asset_id: assetId,
      })),
      fee: ZanoHelper.toAuAmount(Config.blockchain.zano.fee),
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
      .then((r) => this.createSendTransferResult(payoutAmount, r));
  }

  private createSendTransferResult(payoutAmount: number, result?: any): ZanoSendTransferResultDto {
    if (!result?.tx_details) throw new Error(`Transfer not sent: response was ${JSON.stringify(result)}`);

    return {
      txId: result.tx_details.tx_hash,
      amount: payoutAmount,
      fee: Config.blockchain.zano.fee,
    };
  }

  async getTransactionHistory(blockHeight: number): Promise<ZanoTransferDto[]> {
    const actualBlockHeight = await this.getNodeBlockHeight();
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

  private async mapTransfer(transferResults: ZanoGetTransferResultDto[]): Promise<ZanoTransferDto[]> {
    return Promise.all(
      transferResults.map(async (tr) => ({
        block: tr.height,
        txId: tr.tx_hash,
        txType: tr.tx_type,
        fee: ZanoHelper.fromAuAmount(tr.fee),
        timestamp: tr.timestamp,
        receive: await this.mapTransferEmployedEntry(tr.employed_entries.receive),
        spent: await this.mapTransferEmployedEntry(tr.employed_entries.spent),
        paymentId: tr.payment_id !== '' ? tr.payment_id : undefined,
        accountIndex: tr.payment_id !== '' ? ZanoHelper.mapPaymentIdHexToIndex(tr.payment_id) : undefined,
      })),
    );
  }

  private async mapTransferEmployedEntry(
    transferEmployedEntry?: ZanoGetTransferEmployedEntryDto[],
  ): Promise<ZanoTransferReceiveDto[] | undefined> {
    if (transferEmployedEntry)
      return Promise.all(
        transferEmployedEntry.map(async (r) => ({
          amount: await this.mapTransferEmployedEntryAmount(r),
          assetId: r.asset_id,
        })),
      );
  }

  private async mapTransferEmployedEntryAmount(dto: ZanoGetTransferEmployedEntryDto): Promise<number> {
    if (dto.asset_id === Config.blockchain.zano.coinId) return ZanoHelper.fromAuAmount(dto.amount);

    const token = await this.getTokenByAssetId(dto.asset_id);
    return ZanoHelper.fromAuAmount(dto.amount, token.decimals);
  }

  // --- UNIMPLEMENTED METHODS --- //
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
