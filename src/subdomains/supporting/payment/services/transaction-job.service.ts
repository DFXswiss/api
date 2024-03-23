import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionService } from './transaction.service';

@Injectable()
export class TransactionJobService {
  private readonly logger = new DfxLogger(TransactionJobService);

  constructor(private readonly transactionService: TransactionService) {}

  // --- SYNCHRONIZE TRANSACTIONS --- //
  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async synchronizeTransactionUser(): Promise<void> {
    if (DisabledProcess(Process.SYNCHRONIZE_TRANSACTION)) return;

    try {
      const transactions = await this.transactionService.getTransactionWithoutUser();

      for (const tx of transactions) {
        const user = this.getTxUser(tx);
        await this.transactionService.update(tx.id, { user });
      }
    } catch (e) {
      this.logger.error(`Error during synchronize transaction user:`, e);
    }
  }

  private getTxUser(tx: Transaction): User | undefined {
    if (tx.buyCrypto) return tx.buyCrypto.user;
    if (tx.buyFiat) return tx.buyFiat.user;
    if (tx.refReward) return tx.refReward.user;
  }
}
