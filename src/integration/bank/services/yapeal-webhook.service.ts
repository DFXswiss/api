import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { CamtStatus, Iso20022Service } from './iso20022.service';

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
  private readonly logger = new DfxLogger(YapealWebhookService);

  private readonly transactionSubject = new Subject<YapealTransactionEvent>();
  public readonly transaction$ = this.transactionSubject.asObservable();

  processWebhook(payload: any): void {
    try {
      const transaction = Iso20022Service.parseCamt054Json(payload);

      if (transaction.status !== CamtStatus.BOOKED) {
        this.logger.verbose(
          `Skipping non-booked transaction ${transaction.accountServiceRef} in state ${transaction.status}`,
        );
        return;
      }

      this.transactionSubject.next({
        accountIban: transaction.accountIban,
        bankTxData: {
          accountServiceRef: transaction.accountServiceRef,
          bookingDate: transaction.bookingDate,
          valueDate: transaction.valueDate,
          amount: transaction.amount,
          currency: transaction.currency,
          creditDebitIndicator:
            transaction.creditDebitIndicator === 'CRDT' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
          name: transaction.name,
          iban: transaction.iban,
          accountIban: transaction.accountIban,
          bic: transaction.bic,
          remittanceInfo: transaction.remittanceInfo,
          endToEndId: transaction.endToEndId,
          txRaw: JSON.stringify(payload),
        },
      });

      this.logger.info(`Processed YAPEAL transaction: ${transaction.accountServiceRef}`);
    } catch (e) {
      this.logger.error('Failed to process YAPEAL webhook:', e);
    }
  }
}
