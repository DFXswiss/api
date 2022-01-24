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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CryptoInputRepository,
      CryptoBuyRepository,
      BankTxRepository,
      BankTxBatchRepository,
      CryptoBuyRepository,
    ]),
    SharedModule,
    AinModule,
    forwardRef(() => UserModule),
  ],
  controllers: [BankTxController, BankController, ExchangeController, CryptoBuyController, TransactionController],
  providers: [
    CryptoInputService,
    CryptoBuyService,
    BankTxService,
    BankService,
    KrakenService,
    BinanceService,
    TransactionService,
  ],
  exports: [CryptoInputService],
})
export class PaymentModule {}
