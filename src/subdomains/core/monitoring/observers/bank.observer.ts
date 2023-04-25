import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BankName } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { Util } from 'src/shared/utils/util';
import { FrickService } from 'src/subdomains/supporting/bank/bank-tx/frick.service';
import { OlkypayService } from 'src/subdomains/supporting/bank/bank-tx/olkypay.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';

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
  constructor(
    monitoringService: MonitoringService,
    private readonly olkypayService: OlkypayService,
    private readonly frickService: FrickService,
    private readonly bankService: BankService,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'bank', 'balance');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async fetch() {
    if (Config.processDisabled(Process.MONITORING)) return;
    let data = [];

    if (Config.bank.olkypay.credentials.clientId) data = data.concat(await this.getOlkypay());
    if (Config.bank.frick.credentials.privateKey) data = data.concat(await this.getFrick());

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

  private async getFrick(): Promise<BankData[]> {
    const accounts = await this.frickService.getBalance();
    const bankData = [];

    for (const account of accounts) {
      const dbBalance = await this.getDbBalance(account.iban);

      bankData.push({
        name: 'Frick',
        currency: account.currency,
        balance: account.balance,
        dbBalance: Util.round(dbBalance, 2),
        difference: account.balance - Util.round(dbBalance, 2),
        balanceOperationYesterday: account.available,
      });
    }

    return bankData;
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
