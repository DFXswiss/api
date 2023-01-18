import { Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
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

@Injectable()
export class DeFiChainStrategy extends PayInStrategy {
  private readonly lock = new Lock(7200);

  constructor(
    private readonly assetService: AssetService,
    private readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(payInFactory, payInRepository);
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.lock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during DeFiChain pay in checks:', e);
    } finally {
      this.lock.release();
    }
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const lastCheckedBlockHeight = await this.payInRepository
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);

    const newEntries = await this.getNewEntriesSince(lastCheckedBlockHeight);

    for (const tx of newEntries) {
      await this.createPayInAndSave(tx);
      log.newRecords.push({ address: tx.address.address, txId: tx.txId });
    }

    this.printInputLog(log, lastCheckedBlockHeight, Blockchain.DEFICHAIN);
  }

  private async getNewEntriesSince(lastHeight: number): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([Blockchain.DEFICHAIN]);
    const histories = await this.deFiChainService.getNewTransactionsHistorySince(lastHeight);

    return this.mapHistoriesToEntries(histories, supportedAssets);
  }

  private mapHistoriesToEntries(histories: AccountHistory[], supportedAssets: Asset[]): PayInEntry[] {
    return histories.map((h) => ({
      address: BlockchainAddress.create(h.owner, Blockchain.DEFICHAIN),
      txId: h.txid,
      txType: h.type,
      blockHeight: h.blockHeight,
      amount: h.amount,
      asset: this.assetService.getByNameSync(supportedAssets, h.asset, Blockchain.DEFICHAIN) ?? null,
    }));
  }
}
