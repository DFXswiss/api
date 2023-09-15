import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentWebhookState } from 'src/subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { CheckStatus } from '../enums/check-status.enum';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoWebhookService {
  constructor(private readonly webhookService: WebhookService, private readonly buyCryptoRepo: BuyCryptoRepository) {}

  async triggerWebhookManual(id: number): Promise<void> {
    const buyCrypto = await this.buyCryptoRepo.findOne({
      where: { id },
      relations: [
        'buy',
        'buy.user',
        'buy.user.wallet',
        'buy.user.userData',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.wallet',
        'cryptoInput',
        'bankTx',
      ],
    });
    if (!buyCrypto) throw new NotFoundException('BuyCrypto not found');

    await this.triggerWebhook(buyCrypto);
  }

  async triggerWebhook(buyCrypto: BuyCrypto): Promise<void> {
    const state = this.getWebhookState(buyCrypto);
    buyCrypto.isCryptoCryptoTransaction
      ? await this.webhookService.cryptoCryptoUpdate(buyCrypto.user, buyCrypto, state)
      : await this.webhookService.fiatCryptoUpdate(buyCrypto.user, buyCrypto, state);
  }

  private getWebhookState(buyCrypto: BuyCrypto): PaymentWebhookState {
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
