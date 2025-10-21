import { Injectable } from '@nestjs/common';
import { isIP } from 'class-validator';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { BankDataService } from '../user/models/bank-data/bank-data.service';
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
    private readonly bankTxService: BankTxService,
    private readonly payInService: PayInService,
    private readonly bankDataService: BankDataService,
    private readonly bankTxReturnService: BankTxReturnService,
  ) {}

  async searchUserDataByKey(query: UserDataSupportQuery): Promise<UserDataSupportInfo[]> {
    const userDatas = await this.getUserDatasByKey(query.key);
    return userDatas.sort((a, b) => a.id - b.id).map((u) => this.toDto(u));
  }

  //*** HELPER METHODS ***//

  private async getUserDatasByKey(key: string): Promise<UserData[]> {
    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false);

    if (Config.formats.phone.test(key)) return this.userDataService.getUsersByPhone(key);

    if (isIP(key)) {
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
    const userDataId = +key;
    if (!isNaN(userDataId)) {
      const userData = await this.userDataService.getUserData(userDataId);
      if (userData) return userData;
    }

    if (IbanTools.validateIBAN(key).valid) {
      const bankData = await this.bankDataService.getBankDataByKey('iban', key, true);
      if (bankData) return bankData.userData;

      const bankTxReturn = await this.bankTxReturnService.getBankTxReturnByIban(key);
      if (bankTxReturn) return bankTxReturn.userData;

      const chargebackBuyCrypto = await this.buyCryptoService.getBuyCryptoByKeys(['chargebackIban'], key, true);
      if (chargebackBuyCrypto) return chargebackBuyCrypto.userData;

      const sell = await this.sellService.getSellByKey('iban', key, true);
      if (sell) return sell.userData;

      return this.bankTxService.getBankTxByKey('iban', key, true).then((b) => b?.userData);
    }

    if (Config.formats.kycHash.test(key)) return this.userDataService.getUserDataByKey('kycHash', key);

    if (Config.formats.bankUsage.test(key))
      return this.buyService.getBuyByKey('bankUsage', key, true).then((b) => b?.userData);

    if (Config.formats.ref.test(key)) return this.userService.getUserByKey('ref', key, true).then((u) => u?.userData);

    if (Config.formats.accountServiceRef.test(key))
      return this.bankTxService.getBankTxByKey('accountServiceRef', key, true).then((b) => b?.userData);

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
      id: userData.id,
      kycStatus: userData.kycStatus,
      accountType: userData.accountType,
      mail: userData.mail,
      name,
    };
  }
}
