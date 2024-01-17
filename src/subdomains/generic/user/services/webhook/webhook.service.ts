import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserData } from '../../models/user-data/user-data.entity';
import { User } from '../../models/user/user.entity';
import { UserRepository } from '../../models/user/user.repository';
import { KycWebhookData } from './dto/kyc-webhook.dto';
import { PaymentWebhookData } from './dto/payment-webhook.dto';
import { WebhookDto, WebhookType } from './dto/webhook.dto';
import { WebhookDataMapper } from './mapper/webhook-data.mapper';

@Injectable()
export class WebhookService {
  private readonly logger = new DfxLogger(WebhookService);

  constructor(
    private readonly http: HttpService,
    private readonly userRepo: UserRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    await this.triggerUserDataWebhook(userData, WebhookDataMapper.mapKycData(userData), WebhookType.KYC_CHANGED);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    await this.triggerUserDataWebhook(userData, WebhookDataMapper.mapKycData(userData), WebhookType.KYC_FAILED, reason);
  }

  async fiatCryptoUpdate(user: User, payment: BuyCrypto): Promise<void> {
    await this.triggerUserWebhook(user, WebhookDataMapper.mapFiatCryptoData(payment), WebhookType.PAYMENT);
  }

  async cryptoCryptoUpdate(user: User, payment: BuyCrypto): Promise<void> {
    await this.triggerUserWebhook(user, WebhookDataMapper.mapCryptoCryptoData(payment), WebhookType.PAYMENT);
  }

  async cryptoFiatUpdate(user: User, payment: BuyFiat): Promise<void> {
    await this.triggerUserWebhook(user, WebhookDataMapper.mapCryptoFiatData(payment), WebhookType.PAYMENT);
  }

  async fiatFiatUpdate(user: User, payment: BuyFiat): Promise<void> {
    await this.triggerUserWebhook(user, WebhookDataMapper.mapFiatFiatData(payment), WebhookType.PAYMENT);
  }

  // --- HELPER METHODS --- //

  private async triggerUserDataWebhook<T extends PaymentWebhookData | KycWebhookData>(
    userData: UserData,
    data: T,
    type: WebhookType,
    reason?: string,
  ): Promise<void> {
    userData.users = await this.userRepo.find({
      where: { userData: { id: userData.id } },
      relations: ['wallet', 'userData'],
    });

    for (const user of userData.users) {
      await this.triggerUserWebhook(user, data, type, reason);
    }
  }

  private async triggerUserWebhook<T extends PaymentWebhookData | KycWebhookData>(
    user: User,
    data: T,
    type: WebhookType,
    reason?: string,
  ): Promise<void> {
    try {
      if (!user.wallet.apiUrl) return;
      if (!user.wallet.apiKey) throw new Error(`ApiKey for wallet ${user.wallet.name} not available`);

      const webhookDto: WebhookDto<T> = {
        id: user.address,
        type: type,
        data: data,
        reason: reason,
      };

      await this.http.post(user.wallet.apiUrl, webhookDto, {
        headers: { 'x-api-key': user.wallet.apiKey },
        retryDelay: 5000,
        tryCount: 3,
      });
    } catch (error) {
      const errMessage = `Exception during ${type} webhook for user ${user.id}:`;

      this.logger.error(errMessage, error);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: {
          subject: `${type} webhook failed`,
          errors: [errMessage, error],
        },
      });
    }
  }
}
