import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';
import { BankController } from './models/bank/bank.controller';
import { BankService } from './models/bank/bank.service';
import { CryptoInputRepository } from './models/crypto-input/crypto-input.repository';
import { CryptoInputService } from './models/crypto-input/crypto-input.service';
import { BankTxBatchRepository } from './models/bank-tx/bank-tx-batch.repository';
import { BankTxController } from './models/bank-tx/bank-tx.controller';
import { BankTxRepository } from './models/bank-tx/bank-tx.repository';
import { BankTxService } from './models/bank-tx/bank-tx.service';
import { CryptoBuyRepository } from './models/crypto-buy/crypto-buy.repository';
import { CryptoBuyService } from './models/crypto-buy/crypto-buy.service';
import { CryptoBuyController } from './models/crypto-buy/crypto-buy.controller';
import { HistoryController } from './models/history/history.controller';
import { HistoryService } from './models/history/history.service';
import { BuyController } from './models/buy/buy.controller';
import { BuyRepository } from './models/buy/buy.repository';
import { BuyService } from './models/buy/buy.service';
import { DepositRepository } from './models/deposit/deposit.repository';
import { DepositService } from './models/deposit/deposit.service';
import { SellController } from './models/sell/sell.controller';
import { SellRepository } from './models/sell/sell.repository';
import { SellService } from './models/sell/sell.service';
import { StakingController } from './models/staking/staking.controller';
import { StakingRepository } from './models/staking/staking.repository';
import { StakingService } from './models/staking/staking.service';
import { RouteController } from './models/route/route.controller';
import { CryptoSellRepository } from './models/crypto-sell/crypto-sell.repository';
import { CryptoSellController } from './models/crypto-sell/crypto-sell.controller';
import { CryptoSellService } from './models/crypto-sell/crypto-sell.service';
import { MasternodeController } from './models/masternode/masternode.controller';
import { MasternodeService } from './models/masternode/masternode.service';
import { MasternodeRepository } from './models/masternode/masternode.repository';
import { StakingRewardRepository } from './models/staking-reward/staking-reward.respository';
import { RefRewardRepository } from './models/ref-reward/ref-reward.repository';
import { StakingRewardController } from './models/staking-reward/staking-reward.controller';
import { RefRewardController } from './models/ref-reward/ref-reward.controller';
import { StakingRewardService } from './models/staking-reward/staking-reward.service';
import { RefRewardService } from './models/ref-reward/ref-reward.service';
import { CryptoStakingService } from './models/crypto-staking/crypto-staking.service';
import { CryptoStakingRepository } from './models/crypto-staking/crypto-staking.repository';
import { CryptoStakingController } from './models/crypto-staking/crypto-staking.controller';
import { CryptoInputController } from './models/crypto-input/crypto-input.controller';
import { BuyCryptoRepository } from './models/buy-crypto/repositories/buy-crypto.repository';
import { BuyCryptoController } from './models/buy-crypto/buy-crypto.controller';
import { BuyCryptoService } from './models/buy-crypto/services/buy-crypto.service';
import { StakingRefRewardService } from './models/staking-ref-reward/staking-ref-reward.service';
import { StakingRefRewardRepository } from './models/staking-ref-reward/staking-ref-reward.repository';
import { BuyCryptoBatchService } from './models/buy-crypto/services/buy-crypto-batch.service';
import { BuyCryptoOutService } from './models/buy-crypto/services/buy-crypto-out.service';
import { BuyCryptoDexService } from './models/buy-crypto/services/buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './models/buy-crypto/services/buy-crypto-notification.service';
import { BuyCryptoBatchRepository } from './models/buy-crypto/repositories/buy-crypto-batch.repository';
import { BankAccountService } from './models/bank-account/bank-account.service';
import { BankAccountRepository } from './models/bank-account/bank-account.repository';
import { CryptoRouteController } from './models/crypto-route/crypto-route.controller';
import { CryptoRouteService } from './models/crypto-route/crypto-route.service';
import { CryptoRouteRepository } from './models/crypto-route/crypto-route.repository';
import { BtcInputService } from './models/crypto-input/btc-input.service';
import { DeFiInputService } from './models/crypto-input/defi-input.service';
import { BuyFiatRepository } from './models/buy-fiat/buy-fiat.repository';
import { BuyFiatController } from './models/buy-fiat/buy-fiat.controller';
import { BuyFiatService } from './models/buy-fiat/buy-fiat.service';
import { DexModule } from './models/dex/dex.module';
import { OlkypayService } from './models/bank-tx/olkypay.service';
import { ChainalysisService } from './models/crypto-input/chainalysis.service';
import { PayoutModule } from './models/payout/payout.module';
import { BuyFiatNotificationService } from './models/buy-fiat/buy-fiat-notification.service';
import { FrickService } from './models/bank-tx/frick.service';
import { BankAccountController } from './models/bank-account/bank-account.controller';
import { ExchangeModule } from './models/exchange/exchange.module';
import { PricingModule } from './models/pricing/pricing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CryptoInputRepository,
      CryptoBuyRepository,
      BuyCryptoRepository,
      BuyCryptoBatchRepository,
      CryptoSellRepository,
      BuyFiatRepository,
      BankTxRepository,
      BankTxBatchRepository,
      BuyRepository,
      SellRepository,
      StakingRepository,
      DepositRepository,
      MasternodeRepository,
      StakingRewardRepository,
      StakingRefRewardRepository,
      RefRewardRepository,
      CryptoStakingRepository,
      StakingRefRewardRepository,
      BankAccountRepository,
      CryptoRouteRepository,
    ]),
    SharedModule,
    AinModule,
    UserModule,
    DexModule,
    PayoutModule,
    ExchangeModule,
    PricingModule,
  ],
  controllers: [
    BankTxController,
    BankController,
    CryptoBuyController,
    BuyCryptoController,
    CryptoSellController,
    BuyFiatController,
    HistoryController,
    RouteController,
    BuyController,
    SellController,
    StakingController,
    MasternodeController,
    StakingRewardController,
    RefRewardController,
    CryptoStakingController,
    CryptoInputController,
    CryptoRouteController,
    BankAccountController,
  ],
  providers: [
    CryptoInputService,
    BtcInputService,
    DeFiInputService,
    CryptoBuyService,
    CryptoSellService,
    BuyFiatNotificationService,
    BuyFiatService,
    BuyCryptoService,
    BuyCryptoBatchService,
    BuyCryptoDexService,
    BuyCryptoNotificationService,
    BuyCryptoOutService,
    BankTxService,
    OlkypayService,
    FrickService,
    BankService,

    HistoryService,
    BuyService,
    SellService,
    StakingService,
    DepositService,
    MasternodeService,
    BuyController,
    SellController,
    StakingController,
    StakingRewardService,
    StakingRefRewardService,
    RefRewardService,
    CryptoStakingService,
    StakingRefRewardService,
    BankAccountService,
    CryptoRouteController,
    CryptoRouteService,
    ChainalysisService,
  ],
  exports: [
    BuyService,
    SellService,
    StakingRewardService,
    RefRewardService,
    MasternodeService,
    StakingService,
    CryptoBuyService,
    BuyCryptoService,
    CryptoSellService,
    BuyFiatService,
    BankTxService,
    CryptoInputService,
    BtcInputService,
    DeFiInputService,
    CryptoStakingService,
    StakingRefRewardService,
    BankAccountService,
    CryptoRouteService,
    OlkypayService,
    FrickService,
  ],
})
export class PaymentModule {}
