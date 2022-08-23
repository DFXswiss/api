import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { FrickService } from 'src/payment/models/bank-tx/frick.service';
import { OlkypayService } from 'src/payment/models/bank-tx/olkypay.service';
import { getCustomRepository } from 'typeorm';

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
  ) {
    super(monitoringService, 'bank', 'balance');
  }

  @Interval(90000)
  async fetch() {
    if (!Config.bank.olkypay.clientId) return;
    const data = [await this.getOlkypay(), ...(await this.getFrick())];

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getOlkypay(): Promise<BankData> {
    const { balance, balanceOperationYesterday } = await this.olkypayService.getBalance();

    const { dbBalance } = await getCustomRepository(BankTxRepository)
      .createQueryBuilder('bankTx')
      .select(
        "SUM(CASE WHEN bankTx.creditDebitIndicator = 'DBIT' THEN bankTx.amount * -1 ELSE bankTx.amount END)",
        'dbBalance',
      )
      .innerJoin('bankTx.batch', 'bankTxBatch')
      .where('bankTxBatch.iban = :iban', { iban: Config.bank.olkypay.ibanEur })
      .getRawOne<{ dbBalance: number }>();

    return {
      name: 'Olkypay',
      currency: 'EUR',
      balance,
      dbBalance,
      difference: balance - dbBalance,
      balanceOperationYesterday,
    };
  }

  private async getFrick(): Promise<BankData[]> {
    const accounts = await this.frickService.getBalance();
    const bankData = [];

    for (const account of accounts) {
      const { dbBalance } = await getCustomRepository(BankTxRepository)
        .createQueryBuilder('bankTx')
        .select(
          "SUM(CASE WHEN bankTx.creditDebitIndicator = 'DBIT' THEN bankTx.amount * -1 ELSE bankTx.amount END)",
          'dbBalance',
        )
        .innerJoin('bankTx.batch', 'bankTxBatch')
        .where('bankTxBatch.iban = :iban', { iban: account.iban })
        .getRawOne<{ dbBalance: number }>();

      bankData.push({
        name: 'Frick',
        currency: account.currency,
        balance: account.balance,
        dbBalance,
        difference: account.balance - dbBalance,
        balanceOperationYesterday: account.available,
      });
    }

    return bankData;
  }
}
