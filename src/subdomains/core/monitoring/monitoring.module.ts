import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankIntegrationModule } from 'src/integration/bank/bank.module';
import { BitcoinModule } from 'src/integration/blockchain/bitcoin/bitcoin.module';
import { IntegrationModule } from 'src/integration/integration.module';
import { LetterModule } from 'src/integration/letter/letter.module';
import { LightningModule } from 'src/integration/lightning/lightning.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { FiatPayInModule } from 'src/subdomains/supporting/fiat-payin/fiat-payin.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { MonitorConnectionPoolService } from './monitor-connection-pool.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { AmlObserver } from './observers/aml.observer';
import { BankObserver } from './observers/bank.observer';
import { BankingBotObserver } from './observers/banking-bot.observer';
import { CheckoutObserver } from './observers/checkout.observer';
import { ExchangeObserver } from './observers/exchange.observer';
import { ExternalServicesObserver } from './observers/external-services.observer';
import { LiquidityObserver } from './observers/liquidity.observer';
import { NodeBalanceObserver } from './observers/node-balance.observer';
import { NodeHealthObserver } from './observers/node-health.observer';
import { PaymentObserver } from './observers/payment.observer';
import { UserObserver } from './observers/user.observer';
import { SystemStateSnapshot } from './system-state-snapshot.entity';
import { SystemStateSnapshotRepository } from './system-state-snapshot.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemStateSnapshot]),
    SharedModule,
    BitcoinModule,
    UserModule,
    NotificationModule,
    BankModule,
    BankIntegrationModule,
    LetterModule,
    IntegrationModule,
    LightningModule,
    FiatPayInModule,
  ],
  providers: [
    SystemStateSnapshotRepository,
    MonitoringService,
    MonitorConnectionPoolService,
    NodeBalanceObserver,
    NodeHealthObserver,
    PaymentObserver,
    UserObserver,
    BankingBotObserver,
    BankObserver,
    ExternalServicesObserver,
    CheckoutObserver,
    AmlObserver,
    ExchangeObserver,
    LiquidityObserver,
  ],
  controllers: [MonitoringController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
