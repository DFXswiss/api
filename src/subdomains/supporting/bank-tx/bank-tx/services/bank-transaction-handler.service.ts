import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { YapealWebhookService } from 'src/integration/bank/services/yapeal-webhook.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BankTx } from '../entities/bank-tx.entity';
import { BankTxService } from './bank-tx.service';

export interface BankTransactionEvent {
  accountIban: string;
  bankTxData: Partial<BankTx>;
}

@Injectable()
export class BankTransactionHandler implements OnModuleInit {
  private readonly logger = new DfxLogger(BankTransactionHandler);

  constructor(
    private readonly yapealWebhookService: YapealWebhookService,
    private readonly yapealService: YapealService,
    private readonly bankTxService: BankTxService,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  onModuleInit() {
    this.yapealWebhookService.getTransactionObservable().subscribe((event) => this.handleTransaction(event));
  }

  private async handleTransaction(event: BankTransactionEvent): Promise<void> {
    try {
      // Enrich with address data from camt.053 if missing in webhook
      if (!event.bankTxData.addressLine1 && event.bankTxData.accountServiceRef && event.bankTxData.bookingDate) {
        const addressDetails = await this.yapealService.getTransactionAddressDetails(
          event.accountIban,
          event.bankTxData.accountServiceRef,
          event.bankTxData.bookingDate,
        );

        if (addressDetails) {
          event.bankTxData.addressLine1 = addressDetails.addressLine1;
          event.bankTxData.addressLine2 = addressDetails.addressLine2;
          event.bankTxData.country = addressDetails.country;
        }
      }

      const multiAccounts = await this.specialAccountService.getMultiAccounts();
      await this.bankTxService.create(event.bankTxData, multiAccounts);
    } catch (e) {
      if (e instanceof ConflictException) {
        return;
      }

      this.logger.error('Failed to handle bank webhook transaction:', e);
    }
  }
}
