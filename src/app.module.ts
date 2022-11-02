import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { StatisticController } from './subdomains/core/statistic/statistic.controller';
import { StatisticService } from './subdomains/core/statistic/statistic.service';
import { CfpService } from './subdomains/core/statistic/cfp.service';
import { SharedModule } from './shared/shared.module';
import { MixModule } from './mix/mix.module';
import { UserModule } from './subdomains/generic/user/user.module';
import { GetConfig } from './config/config';
import { MonitoringModule } from './subdomains/core/monitoring/monitoring.module';
import { NotificationModule } from './subdomains/supporting/notification/notification.module';
import { IntegrationModule } from './integration/integration.module';
import { SubdomainsModule } from './subdomains/subdomains.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(GetConfig().database),
    SharedModule,
    IntegrationModule,
    MixModule,
    SubdomainsModule,
    UserModule,
    MonitoringModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [],
  exports: [],
})
export class AppModule {}
