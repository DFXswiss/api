import { Inject, OnModuleInit } from '@nestjs/common';
import { AssetTransfersCategory, AssetTransfersWithMetadataResult } from 'alchemy-sdk';
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

const NFT_CATEGORIES: string[] = [
  AssetTransfersCategory.ERC721,
  AssetTransfersCategory.ERC1155,
  AssetTransfersCategory.SPECIALNFT,
];

export abstract class AlchemyStrategy extends EvmStrategy implements OnModuleInit {
  protected addressWebhookMessageQueue: QueueHandler;
  protected assetTransfersMessageQueue: QueueHandler;

  @Inject() protected readonly alchemyWebhookService: AlchemyWebhookService;
  @Inject() protected readonly alchemyService: AlchemyService;

  protected abstract getOwnAddresses(): string[];

  // --- POLL ADDRESS --- //

  async pollAddress(depositAddress: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    toBlock ??= await this.alchemyService.getBlockNumber(this.blockchain);
    fromBlock ??= await this.payInRepository
      .findOne({
        where: { address: { address: depositAddress.address, blockchain: depositAddress.blockchain } },
        order: { blockHeight: 'DESC' },
      })
      .then((p) => p?.blockHeight ?? toBlock - 1000);

    await this.alchemyService.syncTransactions({
      blockchain: this.blockchain,
      address: depositAddress.address,
      fromBlock,
      toBlock,
    });
  }

  // --- WEBHOOKS --- //

  protected processAddressWebhookMessageQueue(dto: AlchemyWebhookDto): void {
    this.addressWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(dto))
      .catch((e) => {
        this.logger.error(`Error while processing new pay-in entries with webhook dto ${JSON.stringify(dto)}:`, e);
      });
  }

  protected async processWebhookTransactions(dto: AlchemyWebhookDto): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAddresses = await this.getPayInAddresses();

    const supportedAssets = await this.assetService.getPayInAssets([this.blockchain]);

    const fungibleTransactions = this.filterOutNftWebhookTransactions(dto);
    const relevantTransactions = this.filterWebhookTransactionsByRelevantAddresses(
      fromAddresses,
      toAddresses,
      fungibleTransactions,
    );
    const transactions = AlchemyTransactionMapper.mapWebhookActivities(relevantTransactions);

    const payInEntries = transactions.map((tx) => this.mapAlchemyTransaction(tx, supportedAssets)).filter((p) => p);

    if (payInEntries.length) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave(payInEntries, log);
    }
  }

  // NFT activities (mass airdrop spam) carry the raw event data (tokenId ++ value) in rawContract.rawValue,
  // which mapAlchemyTransaction would misread as an 18-decimal token amount (~1.16e59) — they are never pay-ins.
  // The category label alone is not sufficient: the collective 'token' category covers ERC-20 AND ERC-721
  // transfers, so any NFT marker field also disqualifies an activity.
  private filterOutNftWebhookTransactions(dto: AlchemyWebhookDto): AlchemyWebhookActivityDto[] {
    return dto.event.activity.filter(
      (tx) =>
        !NFT_CATEGORIES.includes(tx.category?.toLowerCase()) && tx.erc721TokenId == null && !tx.erc1155Metadata?.length,
    );
  }

  private filterWebhookTransactionsByRelevantAddresses(
    fromAddresses: string[],
    toAddresses: string[],
    activities: AlchemyWebhookActivityDto[],
  ): AlchemyWebhookActivityDto[] {
    const notFromOwnAddresses = activities.filter((tx) => !Util.includesIgnoreCase(fromAddresses, tx.fromAddress));

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

    const supportedAssets = await this.assetService.getPayInAssets([this.blockchain]);

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

    const asset = this.getTransactionAsset(supportedAssets, transaction.rawContract.address);
    const decimals = transaction.rawContract.decimals ?? asset?.decimals;

    return {
      senderAddresses: transaction.fromAddress,
      receiverAddress: BlockchainAddress.create(transaction.toAddress, this.blockchain),
      txId: transaction.hash,
      txType: this.getTxType(transaction.toAddress),
      blockHeight: Number(transaction.blockNum),
      amount: Util.floorByPrecision(EvmUtil.fromWeiAmount(rawValue, decimals), 15), // temporary precision fix
      // exact wei captured from the on-chain raw value BEFORE the float collapse above (issue #4287 stage 1), scaled to
      // the asset's own decimals so it lands in crypto_input.amountBaseUnits at the ledger scale; undefined (→ derive
      // from the float) when the asset scale is unknown or incompatible (fail-open).
      amountBaseUnits: this.toBaseUnitsString(EvmUtil.fromWeiAmountString(rawValue, decimals), asset?.decimals),
      asset: asset ?? null,
    };
  }
}
