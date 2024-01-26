import { Injectable } from '@nestjs/common';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { DepositRouteRepository } from 'src/subdomains/supporting/address-pool/route/deposit-route.repository';
import { BankTxRepository } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.repository';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { EntityManager } from 'typeorm';

@Injectable()
export class RepositoryFactory {
  public readonly user: UserRepository;
  public readonly userData: UserDataRepository;
  public readonly bankTx: BankTxRepository;
  public readonly payIn: PayInRepository;
  public readonly buyFiat: BuyFiatRepository;
  public readonly buyCrypto: BuyCryptoRepository;
  public readonly deposit: DepositRepository;
  public readonly depositRoute: DepositRouteRepository;

  constructor(manager: EntityManager) {
    this.user = new UserRepository(manager);
    this.userData = new UserDataRepository(manager);
    this.bankTx = new BankTxRepository(manager);
    this.payIn = new PayInRepository(manager);
    this.buyFiat = new BuyFiatRepository(manager);
    this.buyCrypto = new BuyCryptoRepository(manager);
    this.deposit = new DepositRepository(manager);
    this.depositRoute = new DepositRouteRepository(manager);
  }
}
