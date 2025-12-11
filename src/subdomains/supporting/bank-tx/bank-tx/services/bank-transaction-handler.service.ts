import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { YapealWebhookService } from 'src/integration/bank/services/yapeal-webhook.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BankTx, BankTxIndicator } from '../entities/bank-tx.entity';
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
      const multiAccounts = await this.specialAccountService.getMultiAccounts();

      // Enrich with transaction details from Yapeal Transaction Enrichment API
      await this.enrichTransactionDetails(event.bankTxData);

      await this.bankTxService.create(event.bankTxData, multiAccounts);
    } catch (e) {
      if (e instanceof ConflictException) {
        return;
      }

      this.logger.error('Failed to handle bank webhook transaction:', e);
    }
  }

  private async enrichTransactionDetails(bankTxData: Partial<BankTx>): Promise<void> {
    if (!bankTxData.accountServiceRef) return;

    try {
      const details = await this.yapealService.getTransactionDetails(bankTxData.accountServiceRef);
      if (!details) return;

      // For CREDIT transactions (incoming), ultimateCreditorName is the recipient name entered by sender
      // For DEBIT transactions (outgoing), ultimateDebitorName is the sender name
      const isCredit = bankTxData.creditDebitIndicator === BankTxIndicator.CREDIT;

      const ultimateName = isCredit ? details.ultimateCreditorName : details.ultimateDebitorName;
      const ultimateAddress = isCredit ? details.ultimateCreditorAddress : details.ultimateDebitorAddress;
      const ultimateAddressLines = isCredit ? details.ultimateCreditorAddressLines : details.ultimateDebitorAddressLines;

      if (ultimateName && !bankTxData.ultimateName) {
        bankTxData.ultimateName = ultimateName;
      }

      if (ultimateAddress && !bankTxData.ultimateAddressLine1) {
        bankTxData.ultimateAddressLine1 = ultimateAddress;
      }

      if (ultimateAddressLines?.length && !bankTxData.ultimateAddressLine1) {
        bankTxData.ultimateAddressLine1 = ultimateAddressLines[0];
        if (ultimateAddressLines.length > 1) {
          bankTxData.ultimateAddressLine2 = ultimateAddressLines.slice(1).join(', ');
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to enrich transaction details for ${bankTxData.accountServiceRef}:`, e);
    }
  }
}
