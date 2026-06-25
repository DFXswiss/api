import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { PaymentModule } from '../../supporting/payment/payment.module';
import { UserModule } from '../user/user.module';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Module({
  imports: [SharedModule, UserModule, PaymentModule],
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [],
})
export class PartnerModule {}
