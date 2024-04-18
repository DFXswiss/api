import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { TransactionService } from './transaction.service';

@Injectable()
export class TransactionJobService {
  private readonly logger = new DfxLogger(TransactionJobService);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly settingService: SettingService,
  ) {}

  // --- SYNCHRONIZE TRANSACTIONS --- //
  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async synchronizeTransactionUser(): Promise<void> {
    if (DisabledProcess(Process.SYNCHRONIZE_TRANSACTION)) return;

    try {
      const date = await this.settingService.get('transactionFilterDate', '2022-07-31');

      const transactions = await this.transactionService.getTransactionsWithoutUid(new Date(date));

      for (const tx of transactions) {
        const hash = Util.createHash(
          `${tx.sourceEntity.id}` + tx.created + tx.sourceType + tx.sourceEntity.created,
        ).toUpperCase();
        const uid = `${hash.slice(0, 8)}-${hash.slice(8, 16)}-${hash.slice(16, 24)}`;
        await this.transactionService.update(tx.id, { uid });
      }
    } catch (e) {
      this.logger.error(`Error during synchronize transaction uid:`, e);
    }
  }
}
