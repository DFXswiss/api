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
}

@Injectable()
export class OlkypayObserver extends MetricObserver<OlkypayData> {
  constructor(monitoringService: MonitoringService, private readonly olkypayService: OlkypayService) {
    super(monitoringService, 'olkypay', 'balance');
  }

  @Interval(900000)
  async fetch() {
    const data = await this.getOlkypay();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getOlkypay(): Promise<OlkypayData> {
    const balance = await this.olkypayService.getBalance();

    const dbBalance = await getCustomRepository(BankTxRepository)
      .createQueryBuilder('bankTx')
      .select(
        "SUM(CASE WHEN bankTx.creditDebitIndicator = 'DBIT' THEN bankTx.amount * -1 ELSE bankTx.amount END)",
        'balance',
      )
      .innerJoin('bankTx.batch', 'bankTxBatch')
      .where('bankTxBatch.iban = :iban', { iban: Config.bank.olkypay.iban })
      .getRawOne<{ balance: number }>();

    return {
      balance,
      dbBalance: dbBalance.balance,
      difference: balance - dbBalance.balance,
    };
  }
}
