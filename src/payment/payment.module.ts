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

@Module({
  imports: [
    TypeOrmModule.forFeature([CryptoInputRepository, BankTxRepository, BankTxBatchRepository]),
    SharedModule,
    AinModule,
    UserModule,
  ],
  controllers: [BankTxController, BankController, ExchangeController],
  providers: [CryptoInputService, BankTxService, BankService, KrakenService, BinanceService],
  exports: [],
})
export class PaymentModule {}
