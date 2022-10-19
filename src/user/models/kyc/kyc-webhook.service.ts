import { ConflictException, Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { KycCompleted, KycStatus, UserData } from '../user-data/user-data.entity';
import { UserRepository } from '../user/user.repository';
import { SpiderDataRepository } from '../spider-data/spider-data.repository';
import { WalletService } from '../wallet/wallet.service';

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
}

export class KycWebhookDto {
  id: string;
  result: KycWebhookResult;
  data?: KycWebhookDataDto;
  reason?: string;
}

@Injectable()
export class KycWebhookService {
  constructor(
    private readonly http: HttpService,
    private readonly walletService: WalletService,
    private readonly userRepo: UserRepository,
    private readonly spiderRepo: SpiderDataRepository,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    await this.triggerWebhook(userData, KycWebhookResult.STATUS_CHANGED);
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    await this.triggerWebhook(userData, KycWebhookResult.FAILED, reason);
  }

  private async triggerWebhook(userData: UserData, result: KycWebhookResult, reason?: string): Promise<void> {
    userData.users = await this.userRepo.find({ where: { userData: { id: userData.id } }, relations: ['wallet'] });

    for (const user of userData.users) {
      try {
        if (!user.wallet.isKycClient || !user.wallet.apiUrl) continue;

        const spiderData = await this.spiderRepo.findOne({ where: { userData: { id: userData.id } } });

        const data: KycWebhookDto = {
          id: user.address,
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
            kycStatus:
              KycCompleted(userData.kycStatus) && spiderData?.chatbotResult
                ? KycWebhookStatus.FULL
                : KycCompleted(userData.kycStatus)
                ? KycWebhookStatus.LIGHT
                : userData.kycStatus === KycStatus.REJECTED
                ? KycWebhookStatus.REJECTED
                : KycWebhookStatus.NA,
            kycHash: userData.kycHash,
          },
          reason: reason,
        };

        const apiKey = this.walletService.getApiKeyInternal(user.wallet.name);
        if (!apiKey) throw new ConflictException(`ApiKey for wallet ${user.wallet.name} not available`);

        await this.http.post(`${user.wallet.apiUrl}/kyc/update`, data, {
          headers: { 'x-api-key': apiKey },
        });
      } catch (error) {
        console.error(`Exception during KYC webhook (${result}) for user ${userData.id}:`, error);
      }
    }
  }
}
