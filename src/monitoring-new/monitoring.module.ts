import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { PaymentModule } from 'src/payment/payment.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/user/user.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { NodeBalanceObserver } from './observers/node-balance.observer';
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
  providers: [MonitoringService, NodeBalanceObserver, PaymentObserver, StakingBalanceObserver, UserObserver],
  controllers: [MonitoringController],
  exports: [MonitoringService],
})
export class MonitoringModuleNew {}
