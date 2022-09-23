import { Injectable, NotFoundException } from '@nestjs/common';
import { UserDataRepository } from '../user-data/user-data.repository';
import { HttpService } from 'src/shared/services/http.service';
import { WalletRepository } from '../wallet/wallet.repository';
import { KycCompleted } from '../user-data/user-data.entity';
import { Config } from 'src/config/config';

@Injectable()
export class KycWebhookService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly http: HttpService,
    private readonly walletRepo: WalletRepository,
  ) {}

  async kycChanged(userDataId: number): Promise<void> {
    let data: { id?: string; result?: 'StatusChanged' | 'Failed'; data?: {}; reason?: string } = {};

    const userData = await this.userDataRepo.findOne({ where: { userDataId }, relations: ['users', 'users.wallet'] });

    for (const user of userData.users) {
      const walletUser = await this.walletRepo.findOne({ where: { id: user.wallet.id } });
      if (!walletUser) throw new NotFoundException('Wallet not found');
      if (!walletUser.isKycClient || !walletUser.apiUrl) continue;

      data.id = user.address;
      data.result = 'StatusChanged';

      data.data = {
        mail: userData.mail,
        firstName: userData.firstname,
        lastName: userData.surname,
        street: userData.street,
        houseNumber: userData.houseNumber,
        city: userData.location,
        zip: userData.zip,
        phone: userData.phone,
        kycStatus: KycCompleted(userData.kycStatus) ? 'Full' : 'NA',
        kycHash: userData.kycHash,
      };

      try {
        await this.http.post(`${walletUser.apiUrl}/kyc/handoverKyc`, data, {
          headers: { 'x-api-key': Config.lock.apiKey },
        });
      } catch (error) {
        console.error(`Wallet kyc change webhook error: ${error}`);
      }
    }
  }

  async kycFailed(userDataId: number): Promise<void> {
    let data: { id?: string; result?: 'StatusChanged' | 'Failed'; reason?: string } = {};

    const userData = await this.userDataRepo.findOne({ where: { userDataId }, relations: ['users', 'users.wallet'] });

    for (const user of userData.users) {
      const walletUser = await this.walletRepo.findOne({ where: { id: user.wallet.id } });
      if (!walletUser) throw new NotFoundException('Wallet not found');
      if (!walletUser.isKycClient || !walletUser.apiUrl) continue;

      data.id = user.address;
      data.result = 'Failed';
      //data.reason = '';

      try {
        await this.http.post(`${walletUser.apiUrl}/kyc/handoverKyc`, data, {
          headers: { 'x-api-key': Config.lock.apiKey },
        });
      } catch (error) {
        console.error(`Wallet kyc failed webhook error: ${error}`);
      }
    }
  }
}
