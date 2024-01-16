import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { TransactionDtoMapper } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { KycCompleted, KycStatus, KycType, UserData } from '../../models/user-data/user-data.entity';
import { User } from '../../models/user/user.entity';
import { UserRepository } from '../../models/user/user.repository';
import { KycWebhookData, KycWebhookStatus } from './dto/kyc-webhook.dto';
import { PaymentWebhookData } from './dto/payment-webhook.dto';
import { WebhookDto, WebhookType } from './dto/webhook.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new DfxLogger(WebhookService);

  constructor(
    private readonly http: HttpService,
    private readonly userRepo: UserRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    await this.triggerUserDataWebhook(userData, this.getKycWebhookData(userData), WebhookType.KYC_CHANGED);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    await this.triggerUserDataWebhook(userData, this.getKycWebhookData(userData), WebhookType.KYC_FAILED, reason);
  }

  async fiatCryptoUpdate(user: User, payment: BuyCrypto): Promise<void> {
    await this.triggerUserWebhook(user, this.getFiatCryptoData(payment), WebhookType.PAYMENT);
  }

  async cryptoCryptoUpdate(user: User, payment: BuyCrypto): Promise<void> {
    await this.triggerUserWebhook(user, this.getCryptoCryptoData(payment), WebhookType.PAYMENT);
  }

  async cryptoFiatUpdate(user: User, payment: BuyFiat): Promise<void> {
    await this.triggerUserWebhook(user, this.getCryptoFiatData(payment), WebhookType.PAYMENT);
  }

  async fiatFiatUpdate(user: User, payment: BuyFiat): Promise<void> {
    await this.triggerUserWebhook(user, this.getFiatFiatData(payment), WebhookType.PAYMENT);
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

  private getKycWebhookData(userData: UserData): KycWebhookData {
    return {
      mail: userData.mail,
      firstName: userData.firstname,
      lastName: userData.surname,
      street: userData.street,
      houseNumber: userData.houseNumber,
      city: userData.location,
      zip: userData.zip,
      phone: userData.phone,
      kycStatus: this.getKycWebhookStatus(userData.kycStatus, userData.kycType),
      kycLevel: userData.kycLevel,
      kycHash: userData.kycHash,
      tradingLimit: userData.tradingLimit,
    };
  }

  private getCryptoFiatData(payment: BuyFiat): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: null,
      targetAccount: payment.bankTx?.iban,
    };
  }

  private getFiatFiatData(payment: BuyFiat): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyFiatTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: null,
      targetAccount: payment.bankTx?.iban,
    };
  }

  private getCryptoCryptoData(payment: BuyCrypto): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyCryptoTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: null,
      targetAccount: payment.user?.address,
    };
  }

  private getFiatCryptoData(payment: BuyCrypto): PaymentWebhookData {
    return {
      ...TransactionDtoMapper.mapBuyCryptoTransaction(payment),
      dfxReference: payment.id,
      sourceAccount: payment.bankTx?.iban,
      targetAccount: payment.user?.address,
    };
  }

  public getKycWebhookStatus(kycStatus: KycStatus, kycType: KycType): KycWebhookStatus {
    if (KycCompleted(kycStatus)) {
      return kycType === KycType.LOCK ? KycWebhookStatus.LIGHT : KycWebhookStatus.FULL;
    } else if (kycStatus === KycStatus.REJECTED) {
      return KycWebhookStatus.REJECTED;
    } else {
      return KycWebhookStatus.NA;
    }
  }
}
