import { Injectable, NotFoundException } from '@nestjs/common';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { KycDocumentService } from '../kyc/services/integration/kyc-document.service';
import { BankDataService } from '../user/models/bank-data/bank-data.service';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { User } from '../user/models/user/user.entity';
import { UserService } from '../user/models/user/user.service';
import { SupportDataQuery, SupportReturnData } from './dto/support-data.dto';

@Injectable()
export class SupportService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly bankTxService: BankTxService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly kycDocumentService: KycDocumentService,
    private readonly transactionService: TransactionService,
    private readonly bankDataService: BankDataService,
    private readonly swapService: SwapService,
    private readonly payInService: PayInService,
  ) {}

  async getSupportData(query: SupportDataQuery): Promise<SupportReturnData[]> {
    const userData = await this.getUserData(query.key);
    if (!userData) throw new NotFoundException('User data not found');

    return [{ userDataId: userData.id }];
  }

  //*** HELPER METHODS ***//

  private async getUserData(key: string): Promise<UserData> {
    if (key.length === 14 && key.substring(4, 5) === '-' && key.substring(9, 10) === '-')
      return this.buyService.getBuyByKey('bankUsage', key).then((b) => b?.userData);

    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false)?.[0];

    if (CryptoService.isBlockchainAddress(key)) {
      return (
        this.userService.getUserByKey('address', key) ??
        this.sellService.getSellByKey('deposit.address', key) ??
        this.swapService.getSwapByKey('deposit.address', key)
      ).then((s: User | Sell | Swap) => s.userData);
    }

    return (
      this.buyCryptoService.getBuyCryptoByKey('txId', key) ??
      this.buyCryptoService.getBuyCryptoByKey('chargebackCryptoTxId', key) ??
      this.buyFiatService.getBuyFiatByKey('chargebackTxId', key) ??
      this.payInService.getCryptoInputByKey('inTxId', key) ??
      this.payInService.getCryptoInputByKey('outTxId', key) ??
      this.payInService.getCryptoInputByKey('returnTxId', key)
    ).then((b: BuyCrypto | BuyFiat | CryptoInput) => b?.transaction?.userData);
  }
}
