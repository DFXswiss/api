import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BankTransactionEvent } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-transaction-handler.service';
import { CamtStatus, Iso20022Service } from './iso20022.service';

@Injectable()
export class YapealWebhookService {
  private readonly logger = new DfxLogger(YapealWebhookService);

  private readonly transactionSubject = new Subject<BankTransactionEvent>();

  async processWebhook(payload: any): Promise<void> {
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
          instructedAmount: transaction.instructedAmount,
          instructedCurrency: transaction.instructedCurrency,
          txAmount: transaction.txAmount,
          txCurrency: transaction.txCurrency,
          exchangeSourceCurrency: transaction.exchangeSourceCurrency,
          exchangeTargetCurrency: transaction.exchangeTargetCurrency,
          exchangeRate: transaction.exchangeRate,
          creditDebitIndicator: transaction.creditDebitIndicator,
          name: transaction.name,
          addressLine1: transaction.addressLine1,
          addressLine2: transaction.addressLine2,
          country: transaction.country,
          ultimateName: transaction.ultimateName,
          ultimateAddressLine1: transaction.ultimateAddressLine1,
          ultimateAddressLine2: transaction.ultimateAddressLine2,
          ultimateCountry: transaction.ultimateCountry,
          iban: transaction.iban,
          accountIban: transaction.accountIban,
          virtualIban: transaction.virtualIban,
          bic: transaction.bic,
          remittanceInfo: transaction.remittanceInfo,
          endToEndId: transaction.endToEndId,
          domainCode: transaction.domainCode,
          familyCode: transaction.familyCode,
          subFamilyCode: transaction.subFamilyCode,
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
