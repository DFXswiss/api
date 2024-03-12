import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { PayInEntry } from '../../../interfaces';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmStrategy } from './base/evm.strategy';
import { PayInInputLog } from './base/register.strategy';

@Injectable()
export class BscStrategy extends EvmStrategy {
  protected readonly logger = new DfxLogger(BscStrategy);

  constructor(bscService: PayInBscService) {
    super(bscService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_SMART_CHAIN;
  }

  //*** PUBLIC API ***//

  async getReferenceAssets(): Promise<{ btc: Asset; usdt: Asset }> {
    return Promise.all([
      this.assetService.getAssetByQuery({
        dexName: 'BTCB',
        blockchain: Blockchain.BINANCE_SMART_CHAIN,
        type: AssetType.TOKEN,
      }),
      this.assetService.getAssetByQuery({
        dexName: 'BUSD',
        blockchain: Blockchain.BINANCE_SMART_CHAIN,
        type: AssetType.TOKEN,
      }),
    ]).then(([btc, usdt]) => ({ btc, usdt }));
  }

  async getSourceAssetRepresentation(asset: Asset): Promise<Asset> {
    return asset;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.bsc.bscWalletAddress];
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }

  protected async processNewPayInEntries(): Promise<void> {
    const addresses: string[] = await this.getPayInAddresses();
    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    await this.getTransactionsAndCreatePayIns(addresses, lastCheckedBlockHeight);
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

  private async processNewEntries(allEntries: PayInEntry[], blockHeight: number, log: PayInInputLog) {
    const newEntries = allEntries.filter((t) => t.blockHeight > blockHeight);

    if (newEntries.length === 0) return;

    await this.createPayInsAndSave(newEntries, log);
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
}
