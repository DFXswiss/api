import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { User } from '../user/models/user/user.entity';
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
    const userData = await this.getUserDataByKey(query.key);
    if (!userData) throw new NotFoundException('User data not found');

    return [{ userDataId: userData.id }];
  }

  //*** HELPER METHODS ***//

  private async getUserDataByKey(key: string): Promise<UserData> {
    if (Config.formats.bankUsage.test(key))
      return this.buyService.getBuyByKey('bankUsage', key, true).then((b) => b?.userData);

    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false)?.[0];

    if (Config.formats.address.test(key)) {
      return (
        this.userService.getUserByKey('address', key, true) ??
        this.sellService.getSellByKey('deposit.address', key, true) ??
        this.swapService.getSwapByKey('deposit.address', key, true)
      ).then((s: User | Sell | Swap) => s?.userData);
    }

    return (
      this.buyCryptoService.getBuyCryptoByKey('txId', key, true) ??
      this.buyCryptoService.getBuyCryptoByKey('chargebackCryptoTxId', key, true) ??
      this.buyFiatService.getBuyFiatByKey('chargebackTxId', key, true) ??
      this.payInService.getCryptoInputByKey('inTxId', key) ??
      this.payInService.getCryptoInputByKey('outTxId', key) ??
      this.payInService.getCryptoInputByKey('returnTxId', key)
    ).then((b: BuyCrypto | BuyFiat | CryptoInput) => b?.transaction?.userData);
  }
}
