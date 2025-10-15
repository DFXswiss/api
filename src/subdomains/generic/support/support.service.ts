import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { UserService } from '../user/models/user/user.service';
import { UserDataSupportInfo, UserDataSupportQuery } from './dto/user-data-support.dto';

@Injectable()
export class SupportService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly swapService: SwapService,
    private readonly payInService: PayInService,
  ) {}

  async searchUserDataByKey(query: UserDataSupportQuery): Promise<UserDataSupportInfo[]> {
    const userDatas = await this.getUserDataByKey(query.key);
    if (!userDatas.length) throw new NotFoundException('User data not found');

    return userDatas.map((u) => this.toDto(u));
  }

  //*** HELPER METHODS ***//

  private async getUserDataByKey(key: string): Promise<UserData[]> {
    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false);

    const uniqueUserData = await this.getUniqueUserDataByKey(key);
    return uniqueUserData ? [uniqueUserData] : [];
  }

  private async getUniqueUserDataByKey(key: string): Promise<UserData> {
    if (Config.formats.bankUsage.test(key))
      return this.buyService.getBuyByKey('bankUsage', key, true).then((b) => b?.userData);

    if (Config.formats.address.test(key)) {
      return Promise.all([
        this.userService.getUserByKey('address', key, true),
        this.sellService.getSellByKey('deposit.address', key, true),
        this.swapService.getSwapByKey('deposit.address', key, true),
      ]).then((s) => s.find((s) => s)?.userData);
    }

    return Promise.all([
      this.buyCryptoService.getBuyCryptoByKeys(['txId', 'chargebackCryptoTxId'], key, true).then((bC) => bC?.userData),
      this.buyFiatService.getBuyFiatByKey('chargebackTxId', key, true).then((bF) => bF?.userData),
      this.payInService
        .getCryptoInputByKeys(['inTxId', 'outTxId', 'returnTxId'], key)
        .then((c) => c?.transaction?.userData),
    ]).then((us) => us.find((u) => u));
  }

  private toDto(userData: UserData): UserDataSupportInfo {
    return { userDataId: userData.id };
  }
}
