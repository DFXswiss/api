import { Inject } from '@nestjs/common';
import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { AlchemyWebhookActivityDto, AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { AlchemyWebhookService } from 'src/integration/alchemy/services/alchemy-webhook.service';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
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
import { PayInInputLog, RegisterStrategy } from './register.strategy';

export const SkipTestSwapAssets = ['ZCHF'];

export abstract class EvmStrategy extends RegisterStrategy {
  protected addressWebhookMessageQueue: QueueHandler;
  protected assetTransfersMessageQueue: QueueHandler;

  @Inject()
  protected readonly alchemyWebhookService: AlchemyWebhookService;

  @Inject()
  protected readonly alchemyService: AlchemyService;

  constructor(
    protected readonly nativeCoin: string,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepository: PayInRepository,
    protected readonly assetService: AssetService,
    private readonly repos: RepositoryFactory,
  ) {
    super(payInRepository);
  }

  protected abstract getOwnAddresses(): string[];
  protected abstract getReferenceAssets(): Promise<{ btc: Asset; usdt: Asset }>;
  protected abstract getSourceAssetRepresentation(asset: Asset): Promise<Asset>;

  protected async processNewPayInEntries(): Promise<void> {
    const addresses: string[] = await this.getPayInAddresses();
    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    await this.getTransactionsAndCreatePayIns(addresses, lastCheckedBlockHeight);
  }

  doAmlCheck(_: CryptoInput, route: Staking | Sell | CryptoRoute): CheckStatus {
    return route.user.userData.kycLevel === KycLevel.REJECTED ? CheckStatus.FAIL : CheckStatus.PASS;
  }

  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    const { btc, usdt } = await this.getReferenceAssets();

    for (const entry of entries) {
      try {
        if (!entry.asset) {
          this.logger.warn(
            `No asset identified for ${entry.address.blockchain} pay-in ${'txId' in entry ? entry.txId : entry.inTxId}`,
          );
          continue;
        }

        const asset = await this.getSourceAssetRepresentation(entry.asset);

        const btcAmount = await this.getReferenceAmount(asset, btc, entry);
        const usdtAmount = await this.getReferenceAmount(asset, usdt, entry);

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        this.logger.error(`Could not set reference amounts for ${entry.address.blockchain} pay-in:`, e);
        continue;
      }
    }
  }

  //*** HELPER METHODS ***//

  private async getPayInAddresses(): Promise<string[]> {
    const routes = await this.repos.depositRoute.find({
      where: { deposit: { blockchain: this.blockchain } },
      relations: ['deposit'],
    });

    return routes.map((dr) => dr.deposit.address);
  }

  private async getLastCheckedBlockHeight(): Promise<number> {
    return this.payInRepository
      .findOne({
        select: ['id', 'blockHeight'],
        where: { address: { blockchain: this.blockchain } },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getTransactionsAndCreatePayIns(addresses: string[], lastCheckedBlockHeight: number): Promise<void> {
    const log = this.createNewLogObject();
    const supportedAssets = await this.assetService.getAllAsset([this.blockchain]);

    for (const address of addresses) {
      const [coinHistory, tokenHistory] = await this.payInEvmService.getHistory(address, lastCheckedBlockHeight + 1);

      const entries = this.mapHistoryToPayInEntries(address, coinHistory, tokenHistory, supportedAssets);

      await this.processNewEntries(entries, lastCheckedBlockHeight, log);
    }

    this.printInputLog(log, lastCheckedBlockHeight, this.blockchain);
  }

  private mapHistoryToPayInEntries(
    toAddress: string,
    coinHistory: EvmCoinHistoryEntry[],
    tokenHistory: EvmTokenHistoryEntry[],
    supportedAssets: Asset[],
  ): PayInEntry[] {
    const relevantCoinEntries = this.filterEntriesByRelevantAddresses(this.getOwnAddresses(), toAddress, coinHistory);
    const relevantTokenEntries = this.filterEntriesByRelevantAddresses(this.getOwnAddresses(), toAddress, tokenHistory);

    return [
      ...this.mapCoinEntries(relevantCoinEntries, supportedAssets),
      ...this.mapTokenEntries(relevantTokenEntries, supportedAssets),
    ];
  }

  private filterEntriesByRelevantAddresses<T extends EvmCoinHistoryEntry | EvmTokenHistoryEntry>(
    fromAddresses: string[],
    toAddress: string,
    transactions: T[],
  ): T[] {
    const notFromOwnAddresses = transactions.filter((tx) => !Util.includesIgnoreCase(fromAddresses, tx.from));

    return notFromOwnAddresses.filter((tx) => Util.equalsIgnoreCase(tx.to, toAddress));
  }

  private mapCoinEntries(coinTransactions: EvmCoinHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return coinTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.fromWeiAmount(tx.value),
      asset: this.getTransactionAsset(supportedAssets) ?? null,
    }));
  }

  private mapTokenEntries(tokenTransactions: EvmTokenHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return tokenTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.fromWeiAmount(tx.value, parseInt(tx.tokenDecimal)),
      asset: this.getTransactionAsset(supportedAssets, tx.contractAddress) ?? null,
    }));
  }

  private async processNewEntries(allEntries: PayInEntry[], blockHeight: number, log: PayInInputLog) {
    const newEntries = allEntries.filter((t) => t.blockHeight > blockHeight);

    if (newEntries.length === 0) return;

    await this.addReferenceAmounts(newEntries);

    await this.createPayInsAndSave(newEntries, log);
  }

  protected processAddressWebhookMessageQueue(dto: AlchemyWebhookDto): void {
    this.addressWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(dto))
      .catch((e) => {
        this.logger.error('Error while process new payin entries', e);
      });
  }

  private async processWebhookTransactions(dto: AlchemyWebhookDto): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAdresses = await this.getPayInAddresses();

    const relevantTransactions = this.filterWebhookTransactionsByRelevantAddresses(fromAddresses, toAdresses, dto);

    const payInEntries = await this.mapWebhookTransactions(relevantTransactions);

    await this.addReferenceAmounts(payInEntries);

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

  private getTransactionAsset(supportedAssets: Asset[], chainId?: string): Asset | undefined {
    if (chainId) {
      return this.assetService.getByChainIdSync(supportedAssets, this.blockchain, chainId);
    }

    return this.assetService.getByQuerySync(supportedAssets, {
      dexName: this.nativeCoin,
      blockchain: this.blockchain,
      type: AssetType.COIN,
    });
  }

  protected processAssetTransfersMessageQueue(assetTransfers: AssetTransfersWithMetadataResult[]): void {
    this.assetTransfersMessageQueue
      .handle<void>(async () => this.processAssetTransfers(assetTransfers))
      .catch((e) => {
        this.logger.error('Error while process payin entries', e);
      });
  }

  private async processAssetTransfers(assetTransfers: AssetTransfersWithMetadataResult[]): Promise<void> {
    const fromAddresses = this.getOwnAddresses();
    const toAdresses = await this.getPayInAddresses();

    const relevantAssetTransfers = this.filterAssetTransfersByRelevantAddresses(
      fromAddresses,
      toAdresses,
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
      await this.addReferenceAmounts(payInEntries);

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
}
