import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { BankTxBatchRepository } from 'src/payment/models/bank-tx/bank-tx-batch.repository';
import { OlkypayService } from 'src/payment/models/bank-tx/olkypay.service';
import { PaymentModule } from 'src/payment/payment.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { BankingBotObserver } from './observers/banking-bot.observer';
import { NodeBalanceObserver } from './observers/node-balance.observer';
import { NodeHealthObserver } from './observers/node-health.observer';
import { OlkypayObserver } from './observers/olkypay.observer';
import { PaymentObserver } from './observers/payment.observer';
import { StakingBalanceObserver } from './observers/staking-balance.observer';
import { UserObserver } from './observers/user.observer';
import { SystemStateSnapshotRepository } from './system-state-snapshot.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemStateSnapshotRepository]),
    SharedModule,
    AinModule,
    PaymentModule,
    UserModule,
    BankTxBatchRepository,
  ],
  providers: [
    MonitoringService,
    NodeBalanceObserver,
    NodeHealthObserver,
    PaymentObserver,
    StakingBalanceObserver,
    UserObserver,
    BankingBotObserver,
    OlkypayObserver,
    OlkypayService,
    BankTxBatchRepository,
  ],
  controllers: [MonitoringController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
