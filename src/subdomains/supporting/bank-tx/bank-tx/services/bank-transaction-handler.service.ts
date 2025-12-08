import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { YapealWebhookService } from 'src/integration/bank/services/yapeal-webhook.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BankTx } from '../entities/bank-tx.entity';
import { BankTxService } from './bank-tx.service';

@Injectable()
export class BankTransactionHandler implements OnModuleInit {
  private readonly logger = new DfxLogger(BankTransactionHandler);

  constructor(
    private readonly yapealWebhookService: YapealWebhookService,
    private readonly bankTxService: BankTxService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  onModuleInit() {
    this.yapealWebhookService.transaction$.subscribe((event) => this.handleTransaction(event));
  }

  private async handleTransaction(event: { accountIban: string; bankTxData: Partial<BankTx> }): Promise<void> {
    try {
      const virtualIban = await this.virtualIbanService.getByIban(event.accountIban);
      if (!virtualIban) {
        return;
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
