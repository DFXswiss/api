import { Inject } from '@nestjs/common';
import { AlchemyWebhookActivityDto, AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInEntry } from '../../../../interfaces';
import { PayInRepository } from '../../../../repositories/payin.repository';
import { PayInEvmService } from '../../../../services/base/payin-evm.service';
import { PayInInputLog, RegisterStrategy } from './register.strategy';

export abstract class EvmStrategy extends RegisterStrategy {
  protected addressWebhookMessageQueue: QueueHandler;

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
    return route.user.userData.kycStatus === KycStatus.REJECTED ? CheckStatus.FAIL : CheckStatus.PASS;
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

        const btcAmount = await this.getReferenceAmount(asset, entry.amount, btc);
        const usdtAmount = await this.getReferenceAmount(asset, entry.amount, usdt);

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
    const notFromOwnAddresses = transactions.filter(
      (tx) => !fromAddresses.map((a) => a.toLowerCase()).includes(tx.from.toLowerCase()),
    );

    return notFromOwnAddresses.filter((tx) => tx.to.toLowerCase() === toAddress.toLowerCase());
  }

  private mapCoinEntries(coinTransactions: EvmCoinHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return coinTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.fromWeiAmount(tx.value),
      asset:
        this.assetService.getByQuerySync(supportedAssets, {
          dexName: this.nativeCoin,
          blockchain: this.blockchain,
          type: AssetType.COIN,
        }) ?? null,
    }));
  }

  private mapTokenEntries(tokenTransactions: EvmTokenHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return tokenTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.fromWeiAmount(tx.value, parseInt(tx.tokenDecimal)),
      asset: this.assetService.getByChainIdSync(supportedAssets, this.blockchain, tx.contractAddress) ?? null,
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
      (tx) => !fromAddresses.map((a) => a.toLowerCase()).includes(tx.fromAddress.toLowerCase()),
    );

    return notFromOwnAddresses.filter((tx) =>
      toAddresses.map((a) => a.toLowerCase()).includes(tx.toAddress.toLowerCase()),
    );
  }

  private async mapWebhookTransactions(transactions: AlchemyWebhookActivityDto[]): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([this.blockchain]);

    return transactions.map((tx) => ({
      address: BlockchainAddress.create(tx.toAddress, this.blockchain),
      txId: tx.hash,
      txType: null,
      blockHeight: Number(tx.blockNum),
      amount: this.payInEvmService.fromWeiAmount(tx.rawContract.rawValue, tx.rawContract.decimals),
      asset: this.getWebhookTransactionAsset(supportedAssets, tx) ?? null,
    }));
  }

  private getWebhookTransactionAsset(
    supportedAssets: Asset[],
    transaction: AlchemyWebhookActivityDto,
  ): Asset | undefined {
    if (transaction.rawContract.address) {
      return this.assetService.getByChainIdSync(supportedAssets, this.blockchain, transaction.rawContract.address);
    }

    return this.assetService.getByQuerySync(supportedAssets, {
      dexName: this.nativeCoin,
      blockchain: this.blockchain,
      type: AssetType.COIN,
    });
  }
}
