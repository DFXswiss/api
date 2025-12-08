import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  YapealTransactionStatus,
  YapealTransactionType,
  YapealWebhookPayloadDto,
  YapealWebhookTransactionDto,
} from '../dto/yapeal-webhook.dto';
import { BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';

export interface YapealTransactionEvent {
  accountIban: string;
  bankTxData: {
    accountServiceRef: string;
    bookingDate?: Date;
    valueDate?: Date;
    amount: number;
    currency: string;
    creditDebitIndicator: BankTxIndicator;
    name?: string;
    iban?: string;
    accountIban: string;
    bic?: string;
    remittanceInfo?: string;
    endToEndId?: string;
    txRaw: string;
  };
}

@Injectable()
export class YapealWebhookService {
  private readonly transactionSubject = new Subject<YapealTransactionEvent>();
  public readonly transaction$ = this.transactionSubject.asObservable();

  processWebhook(payload: YapealWebhookPayloadDto): void {
    const { data } = payload;

    if (data.status !== YapealTransactionStatus.BOOKED || data.type !== YapealTransactionType.CREDIT) {
      return;
    }

    this.transactionSubject.next({
      accountIban: data.iban,
      bankTxData: this.mapToBankTx(data),
    });
  }

  private mapToBankTx(data: YapealWebhookTransactionDto) {
    return {
      accountServiceRef: `YAPEAL-${data.transactionUid}`,
      bookingDate: data.bookingDate ? new Date(data.bookingDate) : undefined,
      valueDate: data.valueDate ? new Date(data.valueDate) : undefined,
      amount: data.amount,
      currency: data.currency,
      creditDebitIndicator:
        data.type === YapealTransactionType.CREDIT ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      name: data.counterpartyName,
      iban: data.counterpartyIban,
      accountIban: data.iban,
      bic: data.counterpartyBic,
      remittanceInfo: data.remittanceInfo,
      endToEndId: data.endToEndId,
      txRaw: JSON.stringify(data.rawData ?? data),
    };
  }
}
