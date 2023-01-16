import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { WalletService } from '../../models/wallet/wallet.service';
import { UserRepository } from '../../models/user/user.repository';
import { KycCompleted, KycStatus, KycType, UserData } from '../../models/user-data/user-data.entity';
import { KycWebhookData, KycWebhookStatus } from './dto/kyc-webhook.dto';
import { PaymentWebhookState, PaymentWebhookData, PaymentWebhookType } from './dto/payment-webhook.dto';
import { WebhookType, WebhookDto } from './dto/webhook.dto';

@Injectable()
export class WebhookService {
  constructor(
    private readonly http: HttpService,
    private readonly walletService: WalletService,
    private readonly userRepo: UserRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    await this.triggerWebhook(userData, this.getKycWebhookData(userData), WebhookType.KYC_CHANGED);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    await this.triggerWebhook(userData, this.getKycWebhookData(userData), WebhookType.KYC_FAILED, reason);
  }

  async fiatCryptoUpdate(userData: UserData, payment: BuyCrypto, state: PaymentWebhookState): Promise<void> {
    await this.triggerWebhook(userData, this.getFiatCryptoData(payment, state), WebhookType.PAYMENT);
  }

  async cryptoCryptoUpdate(userData: UserData, payment: BuyCrypto, state: PaymentWebhookState): Promise<void> {
    await this.triggerWebhook(userData, this.getCryptoCryptoData(payment, state), WebhookType.PAYMENT);
  }

  async cryptoFiatUpdate(userData: UserData, payment: BuyFiat, state: PaymentWebhookState): Promise<void> {
    await this.triggerWebhook(userData, this.getCryptoFiatData(payment, state), WebhookType.PAYMENT);
  }

  async fiatFiatUpdate(userData: UserData, payment: BuyFiat, state: PaymentWebhookState): Promise<void> {
    await this.triggerWebhook(userData, this.getFiatFiatData(payment, state), WebhookType.PAYMENT);
  }

  // --- HELPER METHODS --- //

  private async triggerWebhook<T extends PaymentWebhookData | KycWebhookData>(
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
      try {
        if (!user.wallet.isKycClient || !user.wallet.apiUrl) continue;

        const apiKey = this.walletService.getApiKeyInternal(user.wallet.name);
        if (!apiKey) throw new Error(`ApiKey for wallet ${user.wallet.name} not available`);

        const webhookDto: WebhookDto<T> = {
          id: user.address,
          type: type,
          data: data,
          reason: reason,
        };

        await this.http.post(user.wallet.apiUrl, webhookDto, {
          headers: { 'x-api-key': apiKey },
          retryDelay: 5000,
          tryCount: 3,
        });
      } catch (error) {
        const errMessage = `Exception during ${type} webhook for user ${user.id} & user data ${userData.id}:`;

        console.error(errMessage, error);

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
      kycHash: userData.kycHash,
      tradingLimit: userData.tradingLimit,
    };
  }

  private getCryptoFiatData(payment: BuyFiat, state: PaymentWebhookState): PaymentWebhookData {
    return {
      type: PaymentWebhookType.FIAT_CRYPTO,
      dfxReference: payment.id,
      state: state,
      inputAmount: payment.inputAmount,
      inputAsset: payment.inputAsset,
      outputAmount: payment.outputAmount,
      outputAsset: payment.outputAsset,
      paymentReference: payment.sell.deposit.address,
    };
  }

  private getFiatFiatData(payment: BuyFiat, state: PaymentWebhookState): PaymentWebhookData {
    return {
      type: PaymentWebhookType.FIAT_FIAT,
      dfxReference: payment.id,
      state: state,
      inputAmount: payment.inputAmount,
      inputAsset: payment.inputAsset,
      outputAmount: payment.outputAmount,
      outputAsset: payment.outputAsset,
      //TODO add PaymentReference for FiatFiat
      paymentReference: null,
    };
  }

  private getCryptoCryptoData(payment: BuyCrypto, state: PaymentWebhookState): PaymentWebhookData {
    return {
      type: PaymentWebhookType.CRYPTO_CRYPTO,
      dfxReference: payment.id,
      state: state,
      inputAmount: payment.inputAmount,
      inputAsset: payment.inputAsset,
      outputAmount: payment.outputAmount,
      outputAsset: payment.outputAsset?.name,
      paymentReference: payment.cryptoRoute?.deposit.address,
    };
  }

  private getFiatCryptoData(payment: BuyCrypto, state: PaymentWebhookState): PaymentWebhookData {
    return {
      type: PaymentWebhookType.FIAT_CRYPTO,
      dfxReference: payment.id,
      state: state,
      inputAmount: payment.inputAmount,
      inputAsset: payment.inputAsset,
      outputAmount: payment.outputAmount,
      outputAsset: payment.outputAsset?.name,
      paymentReference: payment.buy.bankUsage,
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
