import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { BankTxRepository } from 'src/payment/models/bank-tx/bank-tx.repository';
import { OlkypayService } from 'src/payment/models/bank-tx/olkypay.service';
import { getCustomRepository } from 'typeorm';

interface OlkypayData {
  balance: number;
  dbBalance: number;
  difference: number;
  balanceOperationYesterday: number;
}

@Injectable()
export class OlkypayObserver extends MetricObserver<OlkypayData> {
  constructor(monitoringService: MonitoringService, private readonly olkypayService: OlkypayService) {
    super(monitoringService, 'olkypay', 'balance');
  }

  @Interval(900000)
  async fetch() {
    if (!Config.bank.olkypay.credentials.clientId) return;
    const data = await this.getOlkypay();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getOlkypay(): Promise<OlkypayData> {
    const { balance, balanceOperationYesterday } = await this.olkypayService.getBalance();

    const { dbBalance } = await getCustomRepository(BankTxRepository)
      .createQueryBuilder('bankTx')
      .select(
        "SUM(CASE WHEN bankTx.creditDebitIndicator = 'DBIT' THEN bankTx.amount * -1 ELSE bankTx.amount END)",
        'dbBalance',
      )
      .innerJoin('bankTx.batch', 'bankTxBatch')
      .where('bankTxBatch.iban = :iban', { iban: Config.bank.olkypay.accounts[0].iban })
      .getRawOne<{ dbBalance: number }>();

    return {
      balance,
      dbBalance,
      difference: balance - dbBalance,
      balanceOperationYesterday,
    };
  }
}
