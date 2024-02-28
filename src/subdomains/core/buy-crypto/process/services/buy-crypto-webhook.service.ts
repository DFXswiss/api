import { Injectable, NotFoundException } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { BuyCryptoExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoWebhookService {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly fiatService: FiatService,
    private readonly buyCryptoRepo: BuyCryptoRepository,
  ) {}

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
        'checkoutTx',
      ],
    });
    if (!buyCrypto) throw new NotFoundException('BuyCrypto not found');

    await this.triggerWebhook(buyCrypto);
  }

  async triggerWebhook(buyCrypto: BuyCrypto): Promise<void> {
    const extended = await this.extendBuyCrypto(buyCrypto);

    buyCrypto.isCryptoCryptoTransaction
      ? await this.webhookService.cryptoCryptoUpdate(buyCrypto.user, extended)
      : await this.webhookService.fiatCryptoUpdate(buyCrypto.user, extended);
  }

  async extendBuyCrypto(buyCrypto: BuyCrypto): Promise<BuyCryptoExtended> {
    const inputAssetEntity =
      buyCrypto.cryptoInput?.asset ?? (await this.fiatService.getFiatByName(buyCrypto.inputAsset));
    return Object.assign(buyCrypto, { inputAssetEntity });
  }
}
