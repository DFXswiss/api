import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentModule } from 'src/payment/payment.module';
import { PocBuyCryptoRepository } from './repositories/buy-crypto.repository';
import { BuyCryptoSaga } from './sagas/buy-crypto.saga';

@Module({
  imports: [TypeOrmModule.forFeature([PocBuyCryptoRepository]), CqrsModule, PaymentModule],
  controllers: [],
  providers: [BuyCryptoSaga],
  exports: [TypeOrmModule],
})
export class BuyModule {}
