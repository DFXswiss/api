import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AinModule } from 'src/ain/ain.module';
import { PaymentModule } from 'src/payment/payment.module';
import { SharedModule } from 'src/shared/shared.module';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { UserModule } from 'src/user/user.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [TypeOrmModule.forFeature([SpiderDataRepository]), SharedModule, AinModule, PaymentModule, UserModule],
  providers: [MonitoringService],
  controllers: [MonitoringController],
  exports: [MonitoringService],
})
export class MonitoringModule {}
