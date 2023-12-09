import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BankName } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';

interface BankData {
  name: string;
  currency: string;
  balance: number;
  dbBalance: number;
  difference: number;
  balanceOperationYesterday: number;
}

@Injectable()
export class BankObserver extends MetricObserver<BankData[]> {
  protected readonly logger = new DfxLogger(BankObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly olkypayService: OlkypayService,
    private readonly bankService: BankService,
    private readonly repos: RepositoryFactory,
    private readonly processService: ProcessService,
  ) {
    super(monitoringService, 'bank', 'balance');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async fetch() {
    if (await this.processService.isDisableProcess(Process.MONITORING)) return;

    let data = [];

    if (Config.bank.olkypay.credentials.clientId) data = data.concat(await this.getOlkypay());

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getOlkypay(): Promise<BankData> {
    const { balance, balanceOperationYesterday } = await this.olkypayService.getBalance();
    const olkyBank = await this.bankService.getBankInternal(BankName.OLKY, 'EUR');
    const dbBalance = await this.getDbBalance(olkyBank.iban);

    return {
      name: 'Olkypay',
      currency: 'EUR',
      balance,
      dbBalance: Util.round(dbBalance, 2),
      difference: balance - Util.round(dbBalance, 2),
      balanceOperationYesterday,
    };
  }

  private async getDbBalance(iban: string): Promise<number> {
    const { dbBalance } = await this.repos.bankTx
      .createQueryBuilder('bankTx')
      .select(
        "SUM(CASE WHEN bankTx.creditDebitIndicator = 'DBIT' THEN bankTx.amount * -1 ELSE bankTx.amount END)",
        'dbBalance',
      )
      .where('bankTx.accountIban = :iban', { iban })
      .getRawOne<{ dbBalance: number }>();
    return dbBalance;
  }
}
