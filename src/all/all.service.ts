import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { AuthCredentialsDto } from 'src/auth/dto/auth-credentials.dto';
import { UserRepository } from 'src/user/user.repository';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { LogRepository } from 'src/log/log.repository';
import { PaymentRepository } from 'src/payment/payment.repository';
import { getManager } from 'typeorm';


export class AllDataService {

  async getAllData(): Promise<any> {

    let result = { users: {}, buys: {}, sells: {} , wallets: {}, logs: {}, payments: {} };

    result.users = await getManager().getCustomRepository(UserRepository).getAllUser();
    result.buys= await getManager().getCustomRepository(BuyRepository).getAll();
    result.sells = await getManager().getCustomRepository(SellRepository).getAll();
    result.wallets = await getManager().getCustomRepository(WalletRepository).getAllWallet();
    result.logs = await getManager().getCustomRepository(LogRepository).getAllLog();
    result.payments = await getManager().getCustomRepository(PaymentRepository).getAllPayment();

    return result;
  }
}
