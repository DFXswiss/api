import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { RevolutService } from 'src/integration/bank/services/revolut.service';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';

interface BankData {
  name: string;
  currency: string;
  balance: number;
  dbBalance: number;
  difference: number;
  balanceOperationYesterday?: number;
}

@Injectable()
export class BankObserver extends MetricObserver<BankData[]> {
  protected readonly logger: DfxLogger;

  constructor(
    monitoringService: MonitoringService,
    readonly loggerFactory: LoggerFactory,
    private readonly olkypayService: OlkypayService,
    private readonly bankService: BankService,
    private readonly repos: RepositoryFactory,
    private readonly revolutService: RevolutService,
  ) {
    super(monitoringService, 'bank', 'balance');

    this.logger = this.loggerFactory.create(BankObserver);
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.MONITORING, timeout: 1800 })
  async fetch() {
    let data = [];

    if (Config.bank.olkypay.credentials.clientId) data = data.concat(await this.getOlkypay());
    if (Config.bank.revolut.clientAssertion) data = data.concat(await this.getRevolut());
    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getOlkypay(): Promise<BankData> {
    const { balance, balanceOperationYesterday } = await this.olkypayService.getBalance();
    const olkyBank = await this.bankService.getBankInternal(IbanBankName.OLKY, 'EUR');
    const dbBalance = await this.getDbBalance(olkyBank.iban, 'EUR');

    return {
      name: 'Olkypay',
      currency: 'EUR',
      balance,
      dbBalance: Util.round(dbBalance, 2),
      difference: balance - Util.round(dbBalance, 2),
      balanceOperationYesterday,
    };
  }

  private async getRevolut(): Promise<BankData[]> {
    const revolutBalances = await this.revolutService.getBalances();
    const revolutBank = await this.bankService.getBankInternal(IbanBankName.REVOLUT, 'EUR');

    const revolutBankData = [];
    for (const balance of revolutBalances) {
      const dbBalance = await this.getDbBalance(revolutBank.iban, balance.currency);
      revolutBankData.push({
        name: 'Revolut',
        currency: balance.currency,
        balance: balance.balance,
        dbBalance: Util.round(dbBalance, 2),
        difference: balance.balance - Util.round(dbBalance, 2),
      });
    }
    return revolutBankData;
  }

  private async getDbBalance(iban: string, currency: string): Promise<number> {
    const { dbBalance } = await this.repos.bankTx
      .createQueryBuilder('bankTx')
      .select(
        "SUM(CASE WHEN bankTx.creditDebitIndicator = 'DBIT' THEN bankTx.amount * -1 ELSE bankTx.amount END)",
        'dbBalance',
      )
      .where('bankTx.accountIban = :iban AND bankTx.currency = :currency', { iban, currency })
      .getRawOne<{ dbBalance: number }>();
    return dbBalance;
  }
}
