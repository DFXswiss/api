import { UserRepository } from 'src/user/user.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { LogRepository } from 'src/log/log.repository';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { UserDataRepository } from 'src/userData/userData.repository';
import { BankDataRepository } from 'src/bankData/bankData.repository';
import { Buy } from 'src/buy/buy.entity';
import { Sell } from 'src/sell/sell.entity';
import { Wallet } from 'src/wallet/wallet.entity';
import { Injectable } from '@nestjs/common';

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
    private readonly buyPaymentRepo: BuyPaymentRepository,
    private readonly sellPaymentRepo: SellPaymentRepository,
  ) {}

  async getAllData(): Promise<any> {
    return {
      users: await this.getAllUser(),
      userData: await this.getAllUserData(),
      bankData: await this.getAllBankData(),
      buys: await this.getAllBuy(),
      sells: await this.getAllSell(),
      wallets: await this.getAllWallet(),
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
    return this.buyRepo.find();
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
      buy: await this.buyPaymentRepo.getAllPayment(),
      sell: await this.sellPaymentRepo.getAllPayment(),
    };
  }
}
