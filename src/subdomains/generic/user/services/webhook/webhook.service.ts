import { BadRequestException, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BuyCryptoExtended, BuyFiatExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { IsNull } from 'typeorm';
import { UserData } from '../../models/user-data/user-data.entity';
import { User } from '../../models/user/user.entity';
import { UserRepository } from '../../models/user/user.repository';
import { CreateWebhookInput } from './dto/create-webhook.dto';
import { WebhookType } from './dto/webhook.dto';
import { WebhookDataMapper } from './mapper/webhook-data.mapper';
import { WebhookNotificationService } from './webhook-notification.service';
import { Webhook } from './webhook.entity';
import { WebhookRepository } from './webhook.repository';

@Injectable()
export class WebhookService {
  private readonly logger = new DfxLogger(WebhookService);

  constructor(
    private readonly webhookRepo: WebhookRepository,
    private readonly userRepo: UserRepository,
    private readonly webhookNotificationService: WebhookNotificationService,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    userData.users ??= await this.userRepo.find({
      where: { userData: { id: userData.id } },
      relations: { wallet: true },
    });
    for (const user of userData.users) {
      await this.create({
        data: JSON.stringify(WebhookDataMapper.mapKycData(userData)),
        type: WebhookType.KYC_CHANGED,
        user,
      });
    }
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    userData.users ??= await this.userRepo.find({
      where: { userData: { id: userData.id } },
      relations: { wallet: true },
    });
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

  private async create(dto: CreateWebhookInput): Promise<Webhook | undefined> {
    if (!dto.user.wallet)
      dto.user = await this.userRepo.findOne({ where: { id: dto.user.id }, relations: { wallet: true } });
    if (!dto.user.wallet.apiUrl) return;

    const existing = await this.webhookRepo.findOne({
      where: {
        data: dto.data,
        type: dto.type,
        reason: dto.reason,
        user: { id: dto.user.id },
        lastTryDate: IsNull(),
      },
      relations: { user: true },
    });
    if (existing) throw new BadRequestException('Webhook already created');

    const entity = this.webhookRepo.create(dto);

    // try to send the webhook
    try {
      const result = await this.webhookNotificationService.triggerUserWebhook(entity);
      entity.sentWebhook(result);
    } catch (e) {
      this.logger.error(`Failed to send webhook for ${dto.user.id}:`, e);
    }

    return this.webhookRepo.save(entity);
  }
}
