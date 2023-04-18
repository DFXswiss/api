import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/integration/blockchain/ain/ain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { BankingBotObserver } from './observers/banking-bot.observer';
import { ExternalServicesObserver } from './observers/external-services.observer';
import { NodeBalanceObserver } from './observers/node-balance.observer';
import { NodeHealthObserver } from './observers/node-health.observer';
import { BankObserver } from './observers/bank.observer';
import { PaymentObserver } from './observers/payment.observer';
import { UserObserver } from './observers/user.observer';
import { SystemStateSnapshotRepository } from './system-state-snapshot.repository';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { BankModule as BankIntegrationModule } from 'src/integration/bank/bank.module';
import { LetterModule } from 'src/integration/letter/letter.module';
import { IntegrationModule } from 'src/integration/integration.module';
import { SystemStateSnapshot } from './system-state-snapshot.entity';
import { WhaleHealthObserver } from './observers/whale-health.observer';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemStateSnapshot]),
    SharedModule,
    AinModule,
    UserModule,
    NotificationModule,
    BankModule,
    BankIntegrationModule,
    LetterModule,
    IntegrationModule,
  ],
  providers: [
    SystemStateSnapshotRepository,
    MonitoringService,
    NodeBalanceObserver,
    NodeHealthObserver,
    PaymentObserver,
    UserObserver,
    BankingBotObserver,
    BankObserver,
    ExternalServicesObserver,
    WhaleHealthObserver,
  ],
  controllers: [MonitoringController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
