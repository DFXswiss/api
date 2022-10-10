import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { WalletRepository } from '../wallet/wallet.repository';
import { KycCompleted, UserData } from '../user-data/user-data.entity';
import { Config } from 'src/config/config';
import { UserRepository } from '../user/user.repository';
import { SpiderDataRepository } from '../spider-data/spider-data.repository';

export enum KycWebhookStatus {
  NA = 'NA',
  LIGHT = 'Light',
  FULL = 'Full',
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
    private readonly walletRepo: WalletRepository,
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
    userData.users ??= await this.userRepo.find({ where: { userData: { id: userData.id } }, relations: ['wallet'] });

    for (const user of userData.users) {
      try {
        if (!user.wallet?.id)
          console.error(`Tried to trigger webhook for user ${userData.id}, but wallet were not loaded`);
        const walletUser = await this.walletRepo.findOne({ where: { id: user.wallet.id } });
        if (!walletUser || !walletUser.isKycClient || !walletUser.apiUrl) continue;

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
            //TODO change for KYC Update v2
            kycStatus:
              KycCompleted(userData.kycStatus) && spiderData?.chatbotResult
                ? KycWebhookStatus.FULL
                : KycCompleted(userData.kycStatus)
                ? KycWebhookStatus.LIGHT
                : KycWebhookStatus.NA,
            kycHash: userData.kycHash,
          },
          reason: reason,
        };

        await this.http.post(`${walletUser.apiUrl}/kyc/update`, data, {
          headers: { 'x-api-key': Config.lock.apiKey },
        });
      } catch (error) {
        console.error(`Exception during KYC webhook (${result}) for user ${userData.id}: ${error}`);
      }
    }
  }
}
