import { Inject } from '@nestjs/common';
import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { AlchemyWebhookActivityDto, AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInEntry } from '../../../../interfaces';
import { PayInRepository } from '../../../../repositories/payin.repository';
import { PayInEvmService } from '../../../../services/base/payin-evm.service';
import { RegisterStrategy } from './register.strategy';

export abstract class EvmStrategy extends RegisterStrategy {
  protected addressWebhookMessageQueue: QueueHandler;
  protected assetTransfersMessageQueue: QueueHandler;

  @Inject() protected readonly alchemyWebhookService: AlchemyWebhookService;
  @Inject() protected readonly alchemyService: AlchemyService;
  @Inject() protected readonly payInRepository: PayInRepository;
  @Inject() private readonly repos: RepositoryFactory;

  constructor(protected readonly payInEvmService: PayInEvmService) {
    super();
  }

  protected abstract getOwnAddresses(): string[];
  protected abstract getReferenceAssets(): Promise<{ btc: Asset; usdt: Asset }>;
  protected abstract getSourceAssetRepresentation(asset: Asset): Promise<Asset>;

  doAmlCheck(_: CryptoInput, route: Staking | Sell | CryptoRoute): CheckStatus {
    return route.user.userData.kycLevel === KycLevel.REJECTED ? CheckStatus.FAIL : CheckStatus.PASS;
  }

  // --- WEBHOOKS --- //

  protected processAddressWebhookMessageQueue(dto: AlchemyWebhookDto): void {
    this.addressWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(dto))
      .catch((e) => {
        this.logger.error('Error while process new payin entries', e);
      });
  }

  private async processWebhookTransactions(dto: AlchemyWebhookDto): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const relevantTransactions = this.filterWebhookTransactionsByRelevantAddresses(fromAddresses, toAddresses, dto);

    const payInEntries = await this.mapWebhookTransactions(relevantTransactions);

    const log = this.createNewLogObject();
    await this.createPayInsAndSave(payInEntries, log);
  }

  private filterWebhookTransactionsByRelevantAddresses(
    fromAddresses: string[],
    toAddresses: string[],
    dto: AlchemyWebhookDto,
  ): AlchemyWebhookActivityDto[] {
    const notFromOwnAddresses = dto.event.activity.filter(
      (tx) => !Util.includesIgnoreCase(fromAddresses, tx.fromAddress),
    );

    return notFromOwnAddresses.filter((tx) => Util.includesIgnoreCase(toAddresses, tx.toAddress));
  }

  private async mapWebhookTransactions(transactions: AlchemyWebhookActivityDto[]): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([this.blockchain]);

    return transactions.map((tx) => ({
      address: BlockchainAddress.create(tx.toAddress, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: Number(tx.blockNum),
      amount: this.payInEvmService.fromWeiAmount(tx.rawContract.rawValue, tx.rawContract.decimals),
      asset: this.getTransactionAsset(supportedAssets, tx.rawContract.address) ?? null,
    }));
  }

  // --- ASSET TRANSFERS --- //

  protected processAssetTransfersMessageQueue(assetTransfers: AssetTransfersWithMetadataResult[]): void {
    this.assetTransfersMessageQueue
      .handle<void>(async () => this.processAssetTransfers(assetTransfers))
      .catch((e) => {
        this.logger.error('Error while process payin entries', e);
      });
  }

  private async processAssetTransfers(assetTransfers: AssetTransfersWithMetadataResult[]): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const relevantAssetTransfers = this.filterAssetTransfersByRelevantAddresses(
      fromAddresses,
      toAddresses,
      assetTransfers,
    );

    const supportedAssets = await this.assetService.getAllAsset([this.blockchain]);

    const payInEntries: PayInEntry[] = [];

    for (const assetTransfer of relevantAssetTransfers) {
      const txId = assetTransfer.hash;
      const asset = this.getTransactionAsset(supportedAssets, assetTransfer.rawContract.address) ?? null;

      if (asset) {
        const dbPayInEntry = await this.payInRepository.findOne({
          where: {
            inTxId: txId,
            asset: { id: asset.id },
            address: {
              address: assetTransfer.to,
              blockchain: this.blockchain,
            },
          },
        });

        if (!dbPayInEntry) {
          const payInEntry: PayInEntry = {
            address: BlockchainAddress.create(assetTransfer.to, this.blockchain),
            txId: txId,
            txType: null,
            blockHeight: Number(assetTransfer.blockNum),
            amount: this.payInEvmService.fromWeiAmount(
              assetTransfer.rawContract.value,
              Number(assetTransfer.rawContract.decimal),
            ),
            asset: asset,
          };

          payInEntries.push(payInEntry);
        }
      }
    }

    if (payInEntries.length) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave(payInEntries, log);
    }
  }

  private filterAssetTransfersByRelevantAddresses(
    fromAddresses: string[],
    toAddresses: string[],
    assetTransfers: AssetTransfersWithMetadataResult[],
  ): AssetTransfersWithMetadataResult[] {
    const notFromOwnAddresses = assetTransfers.filter((tx) => !Util.includesIgnoreCase(fromAddresses, tx.from));

    return notFromOwnAddresses.filter((tx) => Util.includesIgnoreCase(toAddresses, tx.to));
  }

  // --- HELPER METHODS --- //

  protected async getPayInAddresses(): Promise<string[]> {
    const routes = await this.repos.depositRoute.find({
      where: { deposit: { blockchain: this.blockchain } },
      relations: ['deposit'],
    });

    return routes.map((dr) => dr.deposit.address);
  }

  protected getTransactionAsset(supportedAssets: Asset[], chainId?: string): Asset | undefined {
    return chainId
      ? this.assetService.getByChainIdSync(supportedAssets, this.blockchain, chainId)
      : supportedAssets.find((a) => a.type === AssetType.COIN);
  }
}
