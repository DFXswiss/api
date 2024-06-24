import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { MoneroTransferDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PayInEntry } from '../../../interfaces';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class MoneroStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(MoneroStrategy);

  constructor(private readonly payInMoneroService: PayInMoneroService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();

    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    const newEntries = await this.getNewEntries(lastCheckedBlockHeight);

    if (newEntries?.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
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

  private async getNewEntries(lastCheckedBlockHeight: number): Promise<PayInEntry[]> {
    const isHealthy = await this.payInMoneroService.isHealthy();
    if (!isHealthy) throw new Error('Monero Node is unhealthy');

    const transferInResults = await this.payInMoneroService.getTransactionHistory(lastCheckedBlockHeight);
    const relevantTransferInResults = this.filterByRelevantAddresses(this.getOwnAddresses(), transferInResults);

    return this.mapToPayInEntries(relevantTransferInResults);
  }

  private getOwnAddresses(): string[] {
    return [Config.blockchain.monero.walletAddress];
  }

  private filterByRelevantAddresses(ownAddresses: string[], transferResults: MoneroTransferDto[]): MoneroTransferDto[] {
    return transferResults.filter((t) => !ownAddresses.map((a) => a.toLowerCase()).includes(t.address.toLowerCase()));
  }

  private async mapToPayInEntries(transferInResults: MoneroTransferDto[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getMoneroCoin();

    return [...transferInResults].reverse().map((p) => ({
      address: BlockchainAddress.create(p.address, this.blockchain),
      txId: p.txid,
      txType: null,
      blockHeight: p.height,
      amount: p.amount,
      asset,
    }));
  }
}
