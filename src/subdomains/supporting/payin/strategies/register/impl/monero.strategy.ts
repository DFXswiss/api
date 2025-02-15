import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { MoneroTransferDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayInType } from '../../../entities/crypto-input.entity';
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

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
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
    await this.payInMoneroService.checkHealthOrThrow();

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
      senderAddresses: null,
      receiverAddress: BlockchainAddress.create(p.address, this.blockchain),
      txId: p.txid,
      txType: this.getTxType(p),
      blockHeight: p.height,
      amount: p.amount,
      asset,
    }));
  }

  private getTxType(transfer: MoneroTransferDto): PayInType | undefined {
    return transfer.destinations?.some((d) => Util.equalsIgnoreCase(Config.payment.moneroAddress, d.address))
      ? PayInType.PAYMENT
      : PayInType.DEPOSIT;
  }
}
