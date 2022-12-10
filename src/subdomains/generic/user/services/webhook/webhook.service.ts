import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { TradingLimit } from '../../models/user/dto/user.dto';
import { WalletService } from '../../models/wallet/wallet.service';
import { UserRepository } from '../../models/user/user.repository';
import { SpiderDataRepository } from '../../models/spider-data/spider-data.repository';
import { KycCompleted, KycStatus, UserData } from '../../models/user-data/user-data.entity';

export enum KycWebhookStatus {
  NA = 'NA',
  LIGHT = 'Light',
  FULL = 'Full',
  REJECTED = 'Rejected',
}

export enum KycWebhookResult {
  STATUS_CHANGED = 'StatusChanged',
  FAILED = 'Failed',
}

export enum PaymentWebhookType {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT = 'BuyFiat',
}

export enum PaymentWebhookState {
  CREATED = 'Created',
  COMPLETED = 'Completed',
}

export class KycWebhookDataDto {
  mail: string;
  firstName: string;
  lastName: string;
  street: string;
  houseNumber: string;
  city: string;
  zip: string;
  phone: string;
  kycStatus: KycWebhookStatus;
  kycHash: string;
  tradingLimit: TradingLimit;
}

export class KycWebhookDto {
  id?: string;
  result: KycWebhookResult;
  data?: KycWebhookDataDto;
  reason?: string;
}

export class PaymentWebhookDto {
  id?: string;
  type: PaymentWebhookType;
  state: PaymentWebhookState;
  inputAmount: number;
  inputAsset: string;
  outputAmount: number;
  outputAsset: string;
  paymentReference: string;
}

@Injectable()
export class WebhookService {
  constructor(
    private readonly http: HttpService,
    private readonly walletService: WalletService,
    private readonly userRepo: UserRepository,
    private readonly spiderRepo: SpiderDataRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    await this.triggerWebhook(userData, await this.getKycWebhookData(userData, KycWebhookResult.STATUS_CHANGED));
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    await this.triggerWebhook(userData, await this.getKycWebhookData(userData, KycWebhookResult.FAILED, reason));
  }

  async paymentUpdate(userData: UserData, payment: BuyFiat | BuyCrypto, state: PaymentWebhookState): Promise<void> {
    await this.triggerWebhook(userData, this.getPaymentWebhookData(payment, state));
  }

  // --- HELPER METHODS --- //

  private async triggerWebhook(userData: UserData, data: PaymentWebhookDto | KycWebhookDto): Promise<void> {
    userData.users = await this.userRepo.find({
      where: { userData: { id: userData.id } },
      relations: ['wallet', 'userData'],
    });

    for (const user of userData.users) {
      try {
        const currentUrl = data instanceof KycWebhookDto ? user.wallet.kycUrl : user.wallet.paymentUrl;

        if (!user.wallet.isKycClient || !currentUrl) continue;

        const apiKey = this.walletService.getApiKeyInternal(user.wallet.name);
        if (!apiKey) throw new Error(`ApiKey for wallet ${user.wallet.name} not available`);

        data.id = user.address;

        await this.http.post(currentUrl, data, {
          headers: { 'x-api-key': apiKey },
          retryDelay: 5000,
          tryCount: 3,
        });
      } catch (error) {
        const errMessage = `Exception during ${data instanceof KycWebhookDto ? 'KYC' : 'Payment'} webhook for user ${
          user.id
        } & userData ${userData.id}:`;

        console.error(errMessage, error);

        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          input: {
            subject: `${data instanceof KycWebhookDto ? 'KYC' : 'Payment'} Webhook failed`,
            errors: [errMessage, error],
          },
        });
      }
    }
  }

  private async getKycWebhookData(
    userData: UserData,
    result: KycWebhookResult,
    reason?: string,
  ): Promise<KycWebhookDto> {
    const spiderData = await this.spiderRepo.findOne({ where: { userData: { id: userData.id } } });

    return {
      result: result,
      data: {
        mail: userData.mail,
        firstName: userData.firstname,
        lastName: userData.surname,
        street: userData.street,
        houseNumber: userData.houseNumber,
        city: userData.location,
        zip: userData.zip,
        phone: userData.phone,
        kycStatus: this.getKycWebhookStatus(userData.kycStatus, spiderData?.chatbotResult),
        kycHash: userData.kycHash,
        tradingLimit: userData.tradingLimit,
      },
      reason: reason,
    };
  }

  private getPaymentWebhookData(payment: BuyFiat | BuyCrypto, state: PaymentWebhookState): PaymentWebhookDto {
    return {
      type: payment instanceof BuyFiat ? PaymentWebhookType.BUY_FIAT : PaymentWebhookType.BUY_CRYPTO,
      state: state,
      inputAmount: payment.inputAmount,
      inputAsset: payment.inputAsset,
      outputAmount: payment.outputAmount,
      outputAsset:
        payment instanceof BuyFiat
          ? payment.outputAsset
          : payment instanceof BuyCrypto
          ? payment.outputAsset?.name
          : null,
      paymentReference:
        payment instanceof BuyFiat
          ? payment.sell.deposit.address
          : payment instanceof BuyCrypto
          ? payment.buy?.bankUsage
            ? payment.buy.bankUsage
            : payment.cryptoRoute?.deposit.address
          : null,
    };
  }

  public getKycWebhookStatus(kycStatus: KycStatus, chatbotResult: string): KycWebhookStatus {
    if (KycCompleted(kycStatus)) {
      return chatbotResult ? KycWebhookStatus.FULL : KycWebhookStatus.LIGHT;
    } else if (kycStatus === KycStatus.REJECTED) {
      return KycWebhookStatus.REJECTED;
    } else {
      return KycWebhookStatus.NA;
    }
  }
}
