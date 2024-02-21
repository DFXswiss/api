import { BadRequestException, Injectable } from '@nestjs/common';
import { BuyCryptoExtended, BuyFiatExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
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
    for (const user of userData.users) {
      await this.create({
        data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
        type: WebhookType.KYC_CHANGED,
        user,
      });
    }
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    for (const user of userData.users) {
      await this.create({
        data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
        reason,
        type: WebhookType.KYC_FAILED,
        user,
      });
    }
  }

  async fiatCryptoUpdate(user: User, payment: BuyCryptoExtended): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapFiatCryptoData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  async cryptoCryptoUpdate(user: User, payment: BuyCryptoExtended): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapCryptoCryptoData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  async cryptoFiatUpdate(user: User, payment: BuyFiatExtended): Promise<void> {
    await this.create({
      user,
      data: JSON.stringify(WebhookDataMapper.mapCryptoFiatData(payment)),
      type: WebhookType.PAYMENT,
    });
  }

  async fiatFiatUpdate(user: User, payment: BuyFiatExtended): Promise<void> {
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
        sentDate: IsNull(),
      },
      relations: { user: true },
    });
    if (existing) throw new BadRequestException('Webhook already created');

    const entity = this.webhookRepo.create(dto);

    return this.webhookRepo.save(entity);
  }
}
