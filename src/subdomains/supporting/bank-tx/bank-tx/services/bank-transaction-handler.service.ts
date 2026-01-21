import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
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
    private readonly bankTxService: BankTxService,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  onModuleInit() {
    this.yapealWebhookService.getTransactionObservable().subscribe((event) => this.handleTransaction(event));
  }

  private async handleTransaction(event: BankTransactionEvent): Promise<void> {
    const { bankTxData } = event;

    try {
      const multiAccounts = await this.specialAccountService.getMultiAccounts();
      await this.bankTxService.create(bankTxData, multiAccounts);
    } catch (e) {
      if (e instanceof ConflictException) {
        return;
      }

      this.logger.error(
        `Failed to handle bank webhook transaction (transaction ${bankTxData.accountServiceRef} on account ${bankTxData.accountIban}):`,
        e,
      );
    }
  }
}
