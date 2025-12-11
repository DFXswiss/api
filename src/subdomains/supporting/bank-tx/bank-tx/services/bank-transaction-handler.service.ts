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
      // Enrich with data from camt.053 if missing in webhook (address, BkTxCd)
      const needsEnrichment =
        !event.bankTxData.addressLine1 || !event.bankTxData.txFamilyCode;

      if (needsEnrichment && event.bankTxData.accountServiceRef && event.bankTxData.bookingDate) {
        const enrichmentData = await this.yapealService.getTransactionEnrichmentData(
          event.accountIban,
          event.bankTxData.accountServiceRef,
          event.bankTxData.bookingDate,
        );

        if (enrichmentData) {
          // Address data
          event.bankTxData.addressLine1 ??= enrichmentData.addressLine1;
          event.bankTxData.addressLine2 ??= enrichmentData.addressLine2;
          event.bankTxData.country ??= enrichmentData.country;
          // Bank Transaction Code (use camt.053 values as they are more reliable)
          event.bankTxData.txDomainCode = enrichmentData.txDomainCode ?? event.bankTxData.txDomainCode;
          event.bankTxData.txFamilyCode = enrichmentData.txFamilyCode ?? event.bankTxData.txFamilyCode;
          event.bankTxData.txSubFamilyCode = enrichmentData.txSubFamilyCode ?? event.bankTxData.txSubFamilyCode;
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
