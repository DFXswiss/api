import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionState } from 'src/subdomains/core/history/dto/transaction/transaction.dto';
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
