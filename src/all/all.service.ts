import { UserRepository } from 'src/user/user.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { LogRepository } from 'src/log/log.repository';
import { SellPaymentRepository } from 'src/payment/payment-sell.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { getManager } from 'typeorm';
import { UserDataRepository } from 'src/userData/userData.repository';


export class AllDataService {

  async getAllData(): Promise<any> {

    let result = { users: {}, userData: {}, buys: {}, sells: {} , wallets: {}, logs: {}, payments: { buy: {}, sell: {}} };

    result.users = await getManager().getCustomRepository(UserRepository).getAllUser();
    result.userData = await getManager().getCustomRepository(UserDataRepository).getAllUserData();
    result.buys= await getManager().getCustomRepository(BuyRepository).getAll();
    result.sells = await getManager().getCustomRepository(SellRepository).getAll();
    result.wallets = await getManager().getCustomRepository(WalletRepository).getAllWallet();
    result.logs = await getManager().getCustomRepository(LogRepository).getAllLog();
    result.payments.sell = await getManager().getCustomRepository(SellPaymentRepository).getAllPayment();
    result.payments.buy = await getManager().getCustomRepository(BuyPaymentRepository).getAllPayment();

    return result;
  }

  async getAllUser(): Promise<any> {
    return await getManager().getCustomRepository(UserRepository).getAllUser();
  }

  async getAllUserData(): Promise<any> {
    return await getManager().getCustomRepository(UserDataRepository).getAllUserData();
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

    let result = {  buy: {}, sell: {} };

    result.sell = await getManager().getCustomRepository(SellPaymentRepository).getAllPayment();
    result.buy = await getManager().getCustomRepository(BuyPaymentRepository).getAllPayment();

    return result;
  }
}
