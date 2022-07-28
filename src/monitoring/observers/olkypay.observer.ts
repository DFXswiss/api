import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { MetricObserver } from 'src/monitoring/metric.observer';
import { MonitoringService } from 'src/monitoring/monitoring.service';
import { BankTxBatchRepository } from 'src/payment/models/bank-tx/bank-tx-batch.repository';
import { BankTxIndicator } from 'src/payment/models/bank-tx/bank-tx.entity';
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
    super(monitoringService, 'olkypay', 'combined');
  }

  @Interval(10000)
  async fetch() {
    const data = await this.getOlkypay();

    this.emit(data);

    return data;
  }

  // *** HELPER METHODS *** //

  private async getOlkypay(): Promise<OlkypayData> {
    const bankTxBatch = await getCustomRepository(BankTxBatchRepository).findOne({
      where: { iban: Config.bank.olkypay.iban },
    });

    const transactions = await getCustomRepository(BankTxRepository)
      .createQueryBuilder('bankTx')
      .where('bankTx.batchId = :batchId', { batchId: bankTxBatch.id })
      .getMany();

    let dbBalance = 0;
    for (const transaction of transactions) {
      dbBalance += this.amount(transaction.creditDebitIndicator as BankTxIndicator, transaction.amount);
    }
    const balance = await this.olkypayService.getBalance();

    return {
      balance,
      dbBalance,
      difference: balance - dbBalance,
    };
  }

  private amount(indicator: BankTxIndicator, amount: number): number {
    return indicator == BankTxIndicator.CREDIT ? amount : -amount;
  }
}
