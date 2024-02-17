import { BadRequestException, Injectable } from '@nestjs/common';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { IsNull } from 'typeorm';
import { UserData } from '../../models/user-data/user-data.entity';
import { User } from '../../models/user/user.entity';
import { CreateWebhookInput } from './dto/create-webhook.dto';
import { WebhookType } from './dto/webhook.dto';
import { WebhookDataMapper } from './mapper/webhook-data.mapper';
import { Webhook } from './webhook.entity';
import { WebhookRepository } from './webhook.repository';

@Injectable()
export class WebhookService {
  constructor(private readonly webhookRepo: WebhookRepository) {}

  async kycChanged(userData: UserData): Promise<void> {
    await this.create({
      userData,
      data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
      type: WebhookType.KYC_CHANGED,
    });
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    await this.create({
      userData,
      data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
      reason,
      type: WebhookType.KYC_FAILED,
    });
  }

  async fiatCryptoUpdate(user: User, payment: BuyCrypto): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapFiatCryptoData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  async cryptoCryptoUpdate(user: User, payment: BuyCrypto): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapCryptoCryptoData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  async cryptoFiatUpdate(user: User, payment: BuyFiat): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapCryptoFiatData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  async fiatFiatUpdate(user: User, payment: BuyFiat): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapFiatFiatData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  // --- HELPER METHODS --- //

  private async create(dto: CreateWebhookInput): Promise<Webhook> {
    const existing = await this.webhookRepo.findOne({
      where: {
        data: dto.data,
        type: dto.type,
        reason: dto.reason,
        user: { id: dto.user.id },
        userData: { id: dto.userData.id },
        sentDate: IsNull(),
      },
      relations: { user: true, userData: true },
    });
    if (!existing) throw new BadRequestException('Webhook already created');

    const entity = this.webhookRepo.create(dto);

    return this.webhookRepo.save(entity);
  }
}
