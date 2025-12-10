import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BankTransactionEvent } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-transaction-handler.service';
import { CamtStatus, Iso20022Service } from './iso20022.service';

@Injectable()
export class YapealWebhookService {
  private readonly logger = new DfxLogger(YapealWebhookService);

  private readonly transactionSubject = new Subject<BankTransactionEvent>();

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
          instructedAmount: transaction.amount,
          instructedCurrency: transaction.currency,
          txAmount: transaction.amount,
          txCurrency: transaction.currency,
          creditDebitIndicator: transaction.creditDebitIndicator,
          name: transaction.name,
          iban: transaction.iban,
          accountIban: transaction.accountIban,
          bic: transaction.bic,
          remittanceInfo: transaction.remittanceInfo,
          endToEndId: transaction.endToEndId,
          txRaw: JSON.stringify(payload),
        },
      });
    } catch (e) {
      this.logger.error('Failed to process YAPEAL webhook:', e);
    }
  }

  getTransactionObservable(): Observable<BankTransactionEvent> {
    return this.transactionSubject.asObservable();
  }
}
