import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { StatisticController } from './statistic/statistic.controller';
import { StatisticService } from './statistic/statistic.service';
import { CfpService } from './statistic/cfp.service';
import { AinModule } from './blockchain/ain/ain.module';
import { SharedModule } from './shared/shared.module';
import { PaymentModule } from './payment/payment.module';
import { UserModule } from './user/user.module';
import { AdminController } from './admin/admin.controller';
import { GetConfig } from './config/config';
import { MonitoringModule } from './monitoring/monitoring.module';
import { EthereumModule } from './blockchain/ethereum/ethereum.module';
import { BscModule } from './blockchain/bsc/bsc.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(GetConfig().database),
    SharedModule,
    AinModule,
    EthereumModule,
    BscModule,
    PaymentModule,
    UserModule,
    MonitoringModule,
    NotificationModule,
  ],
  controllers: [AppController, StatisticController, AdminController],
  providers: [StatisticService, CfpService],
  exports: [],
})
export class AppModule {}
