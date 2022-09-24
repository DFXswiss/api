import { Injectable, NotFoundException } from '@nestjs/common';
import { UserDataRepository } from '../user-data/user-data.repository';
import { HttpService } from 'src/shared/services/http.service';
import { WalletRepository } from '../wallet/wallet.repository';
import { KycCompleted, UserData } from '../user-data/user-data.entity';
import { Config } from 'src/config/config';

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
    private readonly userDataRepo: UserDataRepository,
    private readonly http: HttpService,
    private readonly walletRepo: WalletRepository,
  ) {}

  async kycChanged(userData: UserData): Promise<void> {
    for (const user of userData.users) {
      const walletUser = await this.walletRepo.findOne({ where: { id: user.wallet.id } });
      if (!walletUser) throw new NotFoundException('Wallet not found');
      if (!walletUser.isKycClient || !walletUser.apiUrl) continue;

      const data: KycWebhookDto = {
        id: user.address,
        result: KycWebhookResult.STATUS_CHANGED,
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
          kycStatus: KycCompleted(userData.kycStatus) ? KycWebhookStatus.FULL : KycWebhookStatus.NA,
          kycHash: userData.kycHash,
        },
      };

      try {
        await this.http.post(`${walletUser.apiUrl}/kyc/update`, data, {
          headers: { 'x-api-key': Config.lock.apiKey },
        });
      } catch (error) {
        console.error(`Wallet kyc change webhook error: ${error}`);
      }
    }
  }

  async kycFailed(userData: UserData, reason: string): Promise<void> {
    for (const user of userData.users) {
      const walletUser = await this.walletRepo.findOne({ where: { id: user.wallet.id } });
      if (!walletUser) throw new NotFoundException('Wallet not found');
      if (!walletUser.isKycClient || !walletUser.apiUrl) continue;

      const data: KycWebhookDto = {
        id: user.address,
        result: KycWebhookResult.FAILED,
        reason: reason,
      };

      try {
        await this.http.post(`${walletUser.apiUrl}/kyc/update`, data, {
          headers: { 'x-api-key': Config.lock.apiKey },
        });
      } catch (error) {
        console.error(`Wallet kyc failed webhook error: ${error}`);
      }
    }
  }
}
