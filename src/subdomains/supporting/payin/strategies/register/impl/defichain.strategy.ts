import { Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInStrategy } from './base/payin.strategy';
import { PayInFactory } from '../../../factories/payin.factory';
import { AccountHistory, PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInService } from '../../../services/payin.service';

@Injectable()
export class DeFiChainStrategy extends PayInStrategy {
  private readonly checkEntriesLock = new Lock(7200);
  private readonly convertTokensLock = new Lock(7200);

  constructor(
    private readonly assetService: AssetService,
    private readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInService: PayInService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(payInFactory, payInRepository);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.checkEntriesLock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during DeFiChain pay in checks:', e);
    } finally {
      this.checkEntriesLock.release();
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async convertTokens(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.convertTokensLock.acquire()) return;

    try {
      await this.deFiChainService.convertTokens();
    } catch (e) {
      console.error('Exception during token conversion:', e);
    } finally {
      this.convertTokensLock.release();
    }
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const lastCheckedBlockHeight = await this.payInRepository
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);

    const newEntries = await this.getNewEntriesSince(lastCheckedBlockHeight);
    // get from DEX instead, or?
    const referencePrices = await this.payInService.getReferencePrices(newEntries);

    for (const tx of newEntries) {
      try {
        await this.createPayInAndSave(tx, referencePrices);
        log.newRecords.push({ address: tx.address.address, txId: tx.txId });
      } catch (e) {
        console.error('Did not register pay-in: ', e);
        continue;
      }
    }

    this.printInputLog(log, lastCheckedBlockHeight, Blockchain.DEFICHAIN);
  }

  private async getNewEntriesSince(lastHeight: number): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([Blockchain.DEFICHAIN]);
    const histories = await this.deFiChainService.getNewTransactionsHistorySince(lastHeight);

    return this.mapHistoriesToEntries(histories, supportedAssets);
  }

  private mapHistoriesToEntries(histories: AccountHistory[], supportedAssets: Asset[]): PayInEntry[] {
    return histories
      .map((h) => ({
        address: BlockchainAddress.create(h.owner, Blockchain.DEFICHAIN),
        txId: h.txid,
        txType: h.type,
        blockHeight: h.blockHeight,
        amount: h.amount,
        asset: this.assetService.getByNameSync(supportedAssets, h.asset, Blockchain.DEFICHAIN) ?? null,
      }))
      .map((h) => this.filterOutNonSellableAndPullPairs(h))
      .filter((p) => p != null);
  }

  private filterOutNonSellableAndPullPairs(p: PayInEntry): PayInEntry | null {
    if (p.asset && (!p.asset.sellable || p.asset.category === AssetCategory.POOL_PAIR)) {
      console.log(`Ignoring unsellable DeFiChain input (${p.amount} ${p.asset}). PayIn entry:`, p);
      return null;
    }

    return p;
  }
}
