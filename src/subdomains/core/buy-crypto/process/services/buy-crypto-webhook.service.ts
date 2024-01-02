import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BuyCrypto } from '../entities/buy-crypto.entity';
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
    buyCrypto.isCryptoCryptoTransaction
      ? await this.webhookService.cryptoCryptoUpdate(buyCrypto.user, buyCrypto)
      : await this.webhookService.fiatCryptoUpdate(buyCrypto.user, buyCrypto);
  }
}
