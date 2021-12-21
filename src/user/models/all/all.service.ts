import { UserRepository } from 'src/user/models/user/user.repository';
import { BuyRepository } from 'src/user/models/buy/buy.repository';
import { SellRepository } from 'src/user/models/sell/sell.repository';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { LogRepository } from 'src/user/models/log/log.repository';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { BankDataRepository } from 'src/user/models/bankData/bankData.repository';
import { Buy } from 'src/user/models/buy/buy.entity';
import { Sell } from 'src/user/models/sell/sell.entity';
import { Wallet } from 'src/user/models/wallet/wallet.entity';
import { Injectable } from '@nestjs/common';
import { PaymentService } from 'src/payment/models/payment/payment.service';

@Injectable()
export class AllDataService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly buyRepo: BuyRepository,
    private readonly sellRepo: SellRepository,
    private readonly walletRepo: WalletRepository,
    private readonly logRepo: LogRepository,
  ) // private readonly paymentService: PaymentService,
  {}

  async getAllData(): Promise<any> {
    return {
      users: await this.getAllUser(),
      userData: await this.getAllUserData(),
      bankData: await this.getAllBankData(),
      buys: await this.getAllBuy(),
      sells: await this.getAllSell(),
      wallets: await this.getAllWallet(),
      // TODO(david): move to payment-module
      logs: await this.getAllLog(),
      payments: await this.getAllPayment(),
    };
  }

  async getAllUser(): Promise<any> {
    return this.userRepo.getAllUser();
  }

  async getAllUserData(): Promise<any> {
    return this.userDataRepo.getAllUserData();
  }

  async getAllBankData(): Promise<any> {
    return this.bankDataRepo.getAllBankData();
  }

  async getAllBuy(): Promise<Buy[]> {
    const allBuy = await this.buyRepo.find({relations: ['user']});

    //workaround for GS's TODO: Remove
    for (const buy of allBuy) {
      buy['address'] = buy.user?.address;
    }
    return allBuy;
  }

  async getAllSell(): Promise<Sell[]> {
    return this.sellRepo.find();
  }

  async getAllWallet(): Promise<Wallet[]> {
    return this.walletRepo.find();
  }

  async getAllLog(): Promise<any> {
    return this.logRepo.getAllLog();
  }

  async getAllPayment(): Promise<any> {
    return {
      buy: [], // await this.paymentService.getAllBuyPayment(),
      sell: [], // await this.paymentService.getAllSellPayment(),
    };
  }
}
