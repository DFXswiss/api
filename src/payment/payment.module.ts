import { forwardRef, Module } from '@nestjs/common';
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
import { TransactionController } from './models/transaction/transaction.controller';
import { TransactionService } from './models/transaction/transaction.service';
import { BitstampService } from './models/exchange/bitstamp.service';
import { BuyController } from './models/buy/buy.controller';
import { BuyRepository } from './models/buy/buy.repository';
import { BuyService } from './models/buy/buy.service';
import { DepositController } from './models/deposit/deposit.controller';
import { DepositRepository } from './models/deposit/deposit.repository';
import { DepositService } from './models/deposit/deposit.service';
import { SellController } from './models/sell/sell.controller';
import { SellRepository } from './models/sell/sell.repository';
import { SellService } from './models/sell/sell.service';
import { StakingController } from './models/staking/staking.controller';
import { StakingRepository } from './models/staking/staking.repository';
import { StakingService } from './models/staking/staking.service';
import { RouteController } from './models/route/route.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CryptoInputRepository,
      CryptoBuyRepository,
      BankTxRepository,
      BankTxBatchRepository,
      CryptoBuyRepository,
      BuyRepository,
      SellRepository,
      StakingRepository,
      DepositRepository,
    ]),
    SharedModule,
    AinModule,
    forwardRef(() => UserModule),
  ],
  controllers: [
    BankTxController,
    BankController,
    ExchangeController,
    CryptoBuyController,
    TransactionController,
    RouteController,
    BuyController,
    SellController,
    StakingController,
    DepositController,
  ],
  providers: [
    CryptoInputService,
    CryptoBuyService,
    BankTxService,
    BankService,
    KrakenService,
    BinanceService,
    BitstampService,
    TransactionService,
    BuyService,
    SellService,
    StakingService,
    DepositService,
    BuyController,
    SellController,
    StakingController,
  ],
  exports: [CryptoInputService, BuyService, SellService],
})
export class PaymentModule {}
