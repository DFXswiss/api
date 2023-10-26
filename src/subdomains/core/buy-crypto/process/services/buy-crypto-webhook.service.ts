import { Injectable } from '@nestjs/common';
import { TransactionState } from 'src/subdomains/core/history/dto/transaction/transaction.dto';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { CheckStatus } from '../enums/check-status.enum';

@Injectable()
export class BuyCryptoWebhookService {
  constructor(private readonly webhookService: WebhookService) {}

  async triggerWebhook(buyCrypto: BuyCrypto): Promise<void> {
    const state = this.getWebhookState(buyCrypto);
    buyCrypto.isCryptoCryptoTransaction
      ? await this.webhookService.cryptoCryptoUpdate(buyCrypto.user, buyCrypto, state)
      : await this.webhookService.fiatCryptoUpdate(buyCrypto.user, buyCrypto, state);
  }

  private getWebhookState(buyCrypto: BuyCrypto): TransactionState {
    if (buyCrypto.chargebackDate) return TransactionState.RETURNED;

    switch (buyCrypto.amlCheck) {
      case CheckStatus.PENDING:
        return TransactionState.AML_PENDING;
      case CheckStatus.FAIL:
        return TransactionState.FAILED;
      case CheckStatus.PASS:
        if (buyCrypto.isComplete) return TransactionState.COMPLETED;
        break;
    }

    if (buyCrypto.outputReferenceAsset) return TransactionState.PROCESSING;

    return TransactionState.CREATED;
  }
}
