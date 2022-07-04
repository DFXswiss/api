import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { StatisticController } from './statistic/statistic.controller';
import { StatisticService } from './statistic/statistic.service';
import { CfpService } from './statistic/cfp.service';
import { AinModule } from './ain/ain.module';
import { SharedModule } from './shared/shared.module';
import { PaymentModule } from './payment/payment.module';
import { UserModule } from './user/user.module';
import { AdminController } from './admin/admin.controller';
import { GetConfig } from './config/config';
import { SeedService } from './shared/seed/seed.service';
import { MonitoringModule } from './monitoring/monitoring.module';
import { MonitoringModuleNew } from './monitoring-new/monitoring.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(GetConfig().database),
    SharedModule,
    AinModule,
    PaymentModule,
    UserModule,
    MonitoringModule,
    MonitoringModuleNew,
  ],
  controllers: [AppController, StatisticController, AdminController],
  providers: [StatisticService, CfpService, SeedService],
  exports: [],
})
export class AppModule {}
