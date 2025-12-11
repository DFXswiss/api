import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BankTransactionEvent } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-transaction-handler.service';
import { CamtStatus, Iso20022Service } from './iso20022.service';
import { YapealService } from './yapeal.service';

@Injectable()
export class YapealWebhookService {
  private readonly logger = new DfxLogger(YapealWebhookService);

  private readonly transactionSubject = new Subject<BankTransactionEvent>();

  constructor(private readonly yapealService: YapealService) {}

  async processWebhook(payload: any): Promise<void> {
    try {
      const transaction = Iso20022Service.parseCamt054Json(payload);

      if (transaction.status !== CamtStatus.BOOKED) {
        this.logger.verbose(
          `Skipping non-booked transaction ${transaction.accountServiceRef} in state ${transaction.status}`,
        );
        return;
      }

      // enrich address data from camt.053 if missing
      if (!transaction.addressLine1 && transaction.accountServiceRef && transaction.bookingDate) {
        const addressDetails = await this.yapealService.getTransactionAddressDetails(
          transaction.accountIban,
          transaction.accountServiceRef,
          transaction.bookingDate,
        );

        if (addressDetails) Object.assign(transaction, addressDetails);
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
          addressLine1: transaction.addressLine1,
          addressLine2: transaction.addressLine2,
          country: transaction.country,
          iban: transaction.iban,
          accountIban: transaction.accountIban,
          virtualIban: transaction.virtualIban,
          bic: transaction.bic,
          remittanceInfo: transaction.remittanceInfo,
          endToEndId: transaction.endToEndId,
          txRaw: JSON.stringify(payload),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to process YAPEAL webhook with payload: ${JSON.stringify(payload)}:`, e);
      throw new InternalServerErrorException(`Failed to process webhook: ${e.message}`);
    }
  }

  getTransactionObservable(): Observable<BankTransactionEvent> {
    return this.transactionSubject.asObservable();
  }
}
