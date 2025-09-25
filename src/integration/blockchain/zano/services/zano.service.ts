import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { HttpService } from 'src/shared/services/http.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { Blockchain } from '../../shared/enums/blockchain.enum';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { ZanoAssetInfoDto, ZanoSendTransferResultDto, ZanoTransactionDto, ZanoTransferDto } from '../dto/zano.dto';
import { ZanoClient } from '../zano-client';

@Injectable()
export class ZanoService extends BlockchainService implements OnModuleInit {
  private readonly client: ZanoClient;

  private depositService: DepositService;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly http: HttpService,
    private readonly assetService: AssetService,
  ) {
    super();

    this.client = new ZanoClient(this.http);
  }

  onModuleInit() {
    this.depositService = this.moduleRef.get(DepositService, { strict: false });
  }

  getDefaultClient(): ZanoClient {
    return this.client;
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.ZANO_ASSET_WHITELIST })
  async setupAssetWhitelist(): Promise<void> {
    if (await this.isHealthy()) {
      const zanoTokens = await this.assetService.getTokens(Blockchain.ZANO);
      const chainIds = zanoTokens.filter((t) => t.chainId).map((t) => t.chainId);

      await this.addAssetsToWhitelist(chainIds);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const nodeStatus = await this.client.getNodeInfo();
      if ('OK' !== nodeStatus) return false;

      const nodeBlockHeight = await this.client.getNodeBlockHeight();
      const walletBlockHeight = await this.client.getWalletBlockHeight();

      return walletBlockHeight > nodeBlockHeight - 5;
    } catch {
      return false;
    }
  }

  async getBlockHeight(): Promise<number> {
    return this.client.getNodeBlockHeight();
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    return this.client.verifySignature(message, address, signature);
  }

  async getCoinBalance(): Promise<number> {
    return this.client.getNativeCoinBalance();
  }

  async getUnlockedCoinBalance(): Promise<number> {
    return this.client.getUnlockedNativeCoinBalance();
  }

  async getTokenBalance(token: Asset): Promise<number> {
    return this.client.getTokenBalance(token);
  }

  async getUnlockedTokenBalance(token: Asset): Promise<number> {
    return this.client.getUnlockedTokenBalance(token);
  }

  async addAssetsToWhitelist(assetIds: string[]): Promise<ZanoAssetInfoDto[]> {
    const assetInfos: ZanoAssetInfoDto[] = [];

    const assetWhitelist = await this.client.getAssetWhitelist();

    for (const assetId of assetIds) {
      const globalFound = assetWhitelist.global_whitelist?.find((a) => Util.equalsIgnoreCase(a.asset_id, assetId));
      const localFound = assetWhitelist.local_whitelist?.find((a) => Util.equalsIgnoreCase(a.asset_id, assetId));

      if (!globalFound && !localFound) {
        assetInfos.push(await this.client.addAssetToWhitelist(assetId));
      }
    }

    return assetInfos;
  }

  getFeeEstimate(): number {
    return this.client.getFeeEstimate();
  }

  async isTxComplete(txId: string, confirmations = 0): Promise<boolean> {
    return this.client.isTxComplete(txId, confirmations);
  }

  async getTransaction(txId: string): Promise<ZanoTransactionDto | undefined> {
    return this.client.getTransaction(txId);
  }

  async getTransactionHistory(blockHeight: number): Promise<ZanoTransferDto[]> {
    return this.client.getTransactionHistory(blockHeight);
  }

  async sendCoin(destinationAddress: string, amount: number): Promise<ZanoSendTransferResultDto> {
    return this.client.sendCoin(destinationAddress, amount);
  }

  async sendCoins(payout: PayoutGroup): Promise<ZanoSendTransferResultDto> {
    return this.client.sendCoins(payout);
  }

  async sendToken(destinationAddress: string, amount: number, token: Asset): Promise<ZanoSendTransferResultDto> {
    return this.client.sendToken(destinationAddress, amount, token);
  }

  async sendTokens(payout: PayoutGroup, token: Asset): Promise<ZanoSendTransferResultDto> {
    return this.client.sendTokens(payout, token);
  }

  async getDeposit(index: number): Promise<Deposit> {
    return this.depositService.getDepositByBlockchainAndIndex(Blockchain.ZANO, index);
  }

  getPaymentRequest(address: string, amount: number): string {
    return `zano:${address}?amount=${Util.numberToFixedString(amount)}`;
  }
}
