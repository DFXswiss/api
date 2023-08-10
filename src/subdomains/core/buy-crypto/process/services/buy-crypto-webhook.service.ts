import { Injectable } from '@nestjs/common';
import { PaymentWebhookState } from 'src/subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { CheckStatus } from '../enums/check-status.enum';

@Injectable()
export class BuyCryptoWebhookService {
  constructor(private readonly webhookService: WebhookService) {}

  async triggerWebhook(buyCrypto: BuyCrypto, webhookState: PaymentWebhookState): Promise<void> {
    buyCrypto.isCryptoCryptoTransaction
      ? this.webhookService.cryptoCryptoUpdate(buyCrypto.user, buyCrypto, webhookState)
      : this.webhookService.fiatCryptoUpdate(buyCrypto.user, buyCrypto, webhookState);
  }

  public getWebhookState(buyCrypto: BuyCrypto): PaymentWebhookState {
    if (buyCrypto.chargebackDate) return PaymentWebhookState.RETURNED;

    switch (buyCrypto.amlCheck) {
      case CheckStatus.PENDING:
        return PaymentWebhookState.AML_PENDING;
      case CheckStatus.FAIL:
        return PaymentWebhookState.FAILED;
      case CheckStatus.PASS:
        if (buyCrypto.isComplete) return PaymentWebhookState.COMPLETED;
        break;
    }

    if (buyCrypto.outputReferenceAsset) return PaymentWebhookState.PROCESSING;

    return PaymentWebhookState.CREATED;
  }
}
