import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
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
import { KrakenService } from './models/exchange/kraken.service';
import { ExchangeController } from './models/exchange/exchange.controller';
import { BinanceService } from './models/exchange/binance.service';
import { CryptoBuyRepository } from './models/crypto-buy/crypto-buy.repository';
import { CryptoBuyService } from './models/crypto-buy/crypto-buy.service';
import { CryptoBuyController } from './models/crypto-buy/crypto-buy.controller';
import { HistoryController } from './models/history/history.controller';
import { HistoryService } from './models/history/history.service';
import { BitstampService } from './models/exchange/bitstamp.service';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CryptoInputRepository,
      CryptoBuyRepository,
      CryptoSellRepository,
      BankTxRepository,
      BankTxBatchRepository,
      BuyRepository,
      SellRepository,
      StakingRepository,
      DepositRepository,
      MasternodeRepository,
      StakingRewardRepository,
      RefRewardRepository,
      CryptoStakingRepository,
    ]),
    SharedModule,
    AinModule,
    UserModule,
  ],
  controllers: [
    BankTxController,
    BankController,
    ExchangeController,
    CryptoBuyController,
    CryptoSellController,
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
  ],
  providers: [
    CryptoInputService,
    CryptoBuyService,
    CryptoSellService,
    BankTxService,
    BankService,
    KrakenService,
    BinanceService,
    BitstampService,
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
    RefRewardService,
    CryptoStakingService,
  ],
  exports: [
    BuyService,
    SellService,
    StakingRewardService,
    RefRewardService,
    MasternodeService,
    StakingService,
    CryptoBuyService,
    CryptoSellService,
    BankTxService,
    CryptoInputService,
  ],
})
export class PaymentModule {}
