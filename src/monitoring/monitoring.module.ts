import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/blockchain/ain/ain.module';
import { PaymentModule } from 'src/payment/payment.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { BankingBotObserver } from './observers/banking-bot.observer';
import { ExternalServicesObserver } from './observers/external-services.observer';
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
    ExternalServicesObserver,
  ],
  controllers: [MonitoringController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
