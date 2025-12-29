import { Inject, OnModuleInit } from '@nestjs/common';
import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { AlchemyNetworkMapper } from 'src/integration/alchemy/alchemy-network-mapper';
import { AlchemyTransactionDto } from 'src/integration/alchemy/dto/alchemy-transaction.dto';
import { AlchemyTransactionMapper } from 'src/integration/alchemy/dto/alchemy-transaction.mapper';
import { AlchemyWebhookActivityDto, AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PayInEntry } from '../../../../interfaces';
import { EvmStrategy } from './evm.strategy';

export abstract class AlchemyStrategy extends EvmStrategy implements OnModuleInit {
  protected addressWebhookMessageQueue: QueueHandler;
  protected assetTransfersMessageQueue: QueueHandler;

  @Inject() protected readonly alchemyWebhookService: AlchemyWebhookService;
  @Inject() protected readonly alchemyService: AlchemyService;

  protected abstract getOwnAddresses(): string[];

  onModuleInit() {
    super.onModuleInit();

    this.addressWebhookMessageQueue = new QueueHandler();
    this.assetTransfersMessageQueue = new QueueHandler();

    this.alchemyWebhookService
      .getAddressWebhookObservable(AlchemyNetworkMapper.toAlchemyNetworkByBlockchain(this.blockchain))
      .subscribe((dto) => this.processAddressWebhookMessageQueue(dto));

    this.alchemyService
      .getAssetTransfersObservable(this.blockchain)
      .subscribe((at) => this.processAssetTransfersMessageQueue(at));
  }

  // --- WEBHOOKS --- //

  protected processAddressWebhookMessageQueue(dto: AlchemyWebhookDto): void {
    this.addressWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(dto))
      .catch((e) => {
        this.logger.error(`Error while processing new pay-in entries with webhook dto ${JSON.stringify(dto)}:`, e);
      });
  }

  private async processWebhookTransactions(dto: AlchemyWebhookDto): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const relevantTransactions = this.filterWebhookTransactionsByRelevantAddresses(fromAddresses, toAddresses, dto);
    const transactions = AlchemyTransactionMapper.mapWebhookActivities(relevantTransactions);

    const payInEntries = transactions.map((tx) => this.mapAlchemyTransaction(tx, supportedAssets)).filter((p) => p);

    if (payInEntries.length) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave(payInEntries, log);
    }
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

  // --- ASSET TRANSFERS --- //

  protected processAssetTransfersMessageQueue(assetTransfers: AssetTransfersWithMetadataResult[]): void {
    this.assetTransfersMessageQueue
      .handle<void>(async () => this.processAssetTransfers(assetTransfers))
      .catch((e) => {
        this.logger.error('Error while processing asset transfers:', e);
      });
  }

  private async processAssetTransfers(assetTransfers: AssetTransfersWithMetadataResult[]): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const relevantAssetTransfers = this.filterAssetTransfersByRelevantAddresses(
      fromAddresses,
      toAddresses,
      assetTransfers,
    );
    const transactions = AlchemyTransactionMapper.mapAssetTransfers(relevantAssetTransfers);

    const payInEntries = transactions.map((tx) => this.mapAlchemyTransaction(tx, supportedAssets)).filter((p) => p);

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

  private mapAlchemyTransaction(transaction: AlchemyTransactionDto, supportedAssets: Asset[]): PayInEntry | undefined {
    const rawValue = transaction.rawContract.rawValue;
    if (!rawValue || rawValue === '0x') return;

    return {
      senderAddresses: transaction.fromAddress,
      receiverAddress: BlockchainAddress.create(transaction.toAddress, this.blockchain),
      txId: transaction.hash,
      txType: this.getTxType(transaction.toAddress),
      blockHeight: Number(transaction.blockNum),
      amount: Util.floorByPrecision(EvmUtil.fromWeiAmount(rawValue, transaction.rawContract.decimals), 15), // temporary precision fix
      asset: this.getTransactionAsset(supportedAssets, transaction.rawContract.address) ?? null,
    };
  }
}
