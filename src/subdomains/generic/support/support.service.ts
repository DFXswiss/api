import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
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
    private readonly swapService: SwapService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly payInService: PayInService,
  ) {}

  async searchUserDataByKey(query: UserDataSupportQuery): Promise<UserDataSupportInfo[]> {
    const userDatas = await this.getUserDatasByKey(query.key);
    if (!userDatas.length) throw new NotFoundException('User data not found');

    const MAX_RESULTS = 20;
    if (userDatas.length > MAX_RESULTS)
      throw new BadRequestException(`Too many results found (${userDatas.length}). Please refine your search.`);

    return userDatas.map((u) => this.toDto(u));
  }

  //*** HELPER METHODS ***//

  private async getUserDatasByKey(key: string): Promise<UserData[]> {
    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false);

    if (Config.formats.phone.test(key)) return this.userDataService.getUsersByPhone(key);

    if (Config.formats.ip.test(key)) {
      const userDatas = await this.userService.getUsersByIp(key).then((u) => u.map((u) => u.userData));
      return Util.toUniqueList(userDatas, 'id');
    }

    const uniqueUserData = await this.getUniqueUserDataByKey(key);
    if (uniqueUserData) return [uniqueUserData];

    // min requirement for a name
    if (key.length >= 2) return this.userDataService.getUsersByName(key);

    return [];
  }

  private async getUniqueUserDataByKey(key: string): Promise<UserData> {
    if (Config.formats.kycHash.test(key)) return this.userDataService.getUserDataByKey('kycHash', key);

    if (Config.formats.bankUsage.test(key))
      return this.buyService.getBuyByKey('bankUsage', key, true).then((b) => b?.userData);

    if (Config.formats.ref.test(key)) return this.userService.getUserByKey('ref', key, true).then((u) => u?.userData);

    if (Config.formats.address.test(key)) {
      return Promise.all([
        this.userService.getUserByKey('address', key, true),
        this.sellService.getSellByKey('deposit.address', key, true),
        this.swapService.getSwapByKey('deposit.address', key, true),
      ]).then((s) => s.find((s) => s)?.userData);
    }

    return Promise.all([
      this.buyCryptoService.getBuyCryptoByKeys(['txId', 'chargebackCryptoTxId'], key, true),
      this.buyFiatService.getBuyFiatByKey('chargebackTxId', key, true),
      this.payInService.getCryptoInputByKeys(['inTxId', 'outTxId', 'returnTxId'], key),
    ]).then((us) => us.find((u) => u)?.userData);
  }

  private toDto(userData: UserData): UserDataSupportInfo {
    const name =
      userData.verifiedName ??
      ([userData.firstname, userData.surname, userData.organization?.name].filter(Boolean).join(' ') || undefined);

    return {
      userDataId: userData.id,
      kycStatus: userData.kycStatus,
      accountType: userData.accountType,
      mail: userData.mail,
      name,
    };
  }
}
