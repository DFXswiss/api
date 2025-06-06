import { Injectable } from '@nestjs/common';
import { ExchangeTxRepository } from 'src/integration/exchange/repositories/exchange-tx.repository';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { PaymentQuoteRepository } from 'src/subdomains/core/payment-link/repositories/payment-quote.repository';
import { RefRewardRepository } from 'src/subdomains/core/referral/reward/ref-reward.repository';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { TradingOrderRepository } from 'src/subdomains/core/trading/repositories/trading-order.respository';
import { TradingRuleRepository } from 'src/subdomains/core/trading/repositories/trading-rule.respository';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { UserRepository } from 'src/subdomains/generic/user/models/user/user.repository';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { DepositRouteRepository } from 'src/subdomains/supporting/address-pool/route/deposit-route.repository';
import { BankTxRepository } from 'src/subdomains/supporting/bank-tx/bank-tx/repositories/bank-tx.repository';
import { CheckoutTxRepository } from 'src/subdomains/supporting/fiat-payin/repositories/checkout-tx.repository';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { TransactionSpecificationRepository } from 'src/subdomains/supporting/payment/repositories/transaction-specification.repository';
import { EntityManager } from 'typeorm';
import { AssetRepository } from '../models/asset/asset.repository';

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
  public readonly transactionSpecification: TransactionSpecificationRepository;
  public readonly checkoutTx: CheckoutTxRepository;
  public readonly asset: AssetRepository;
  public readonly refReward: RefRewardRepository;
  public readonly exchangeTx: ExchangeTxRepository;
  public readonly tradingOrder: TradingOrderRepository;
  public readonly tradingRule: TradingRuleRepository;
  public readonly paymentQuote: PaymentQuoteRepository;

  constructor(manager: EntityManager) {
    this.user = new UserRepository(manager);
    this.userData = new UserDataRepository(manager);
    this.bankTx = new BankTxRepository(manager);
    this.payIn = new PayInRepository(manager);
    this.buyFiat = new BuyFiatRepository(manager);
    this.buyCrypto = new BuyCryptoRepository(manager);
    this.deposit = new DepositRepository(manager);
    this.depositRoute = new DepositRouteRepository(manager);
    this.transactionSpecification = new TransactionSpecificationRepository(manager);
    this.checkoutTx = new CheckoutTxRepository(manager);
    this.asset = new AssetRepository(manager);
    this.refReward = new RefRewardRepository(manager);
    this.exchangeTx = new ExchangeTxRepository(manager);
    this.tradingOrder = new TradingOrderRepository(manager);
    this.tradingRule = new TradingRuleRepository(manager);
    this.paymentQuote = new PaymentQuoteRepository(manager);
  }
}
