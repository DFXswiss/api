import { UserRepository } from 'src/user/user.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { LogRepository } from 'src/log/log.repository';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { getManager } from 'typeorm';
import { UserDataRepository } from 'src/userData/userData.repository';
import { BankDataRepository } from 'src/bankData/bankData.repository';

export class AllDataService {
  async getAllData(): Promise<any> {
    return {
      users: await getManager().getCustomRepository(UserRepository).getAllUser(),
      userData: await getManager().getCustomRepository(UserDataRepository).getAllUserData(),
      bankData: await getManager().getCustomRepository(BankDataRepository).getAllBankData(),
      buys: await getManager().getCustomRepository(BuyRepository).getAll(),
      sells: await getManager().getCustomRepository(SellRepository).getAll(),
      wallets: await getManager().getCustomRepository(WalletRepository).getAllWallet(),
      logs: await getManager().getCustomRepository(LogRepository).getAllLog(),
      payments: await this.getAllPayment(),
    };
  }

  async getAllUser(): Promise<any> {
    return await getManager().getCustomRepository(UserRepository).getAllUser();
  }

  async getAllUserData(): Promise<any> {
    return await getManager().getCustomRepository(UserDataRepository).getAllUserData();
  }

  async getAllBankData(): Promise<any> {
    return await getManager().getCustomRepository(BankDataRepository).getAllBankData();
  }

  async getAllBuy(): Promise<any> {
    return await getManager().getCustomRepository(BuyRepository).getAll();
  }

  async getAllSell(): Promise<any> {
    return await getManager().getCustomRepository(SellRepository).getAll();
  }

  async getAllWallet(): Promise<any> {
    return await getManager().getCustomRepository(WalletRepository).getAllWallet();
  }

  async getAllLog(): Promise<any> {
    return await getManager().getCustomRepository(LogRepository).getAllLog();
  }

  async getAllPayment(): Promise<any> {
    return {
      sell: await getManager().getCustomRepository(SellPaymentRepository).getAllPayment(),
      buy: await getManager().getCustomRepository(BuyPaymentRepository).getAllPayment(),
    };
  }
}
