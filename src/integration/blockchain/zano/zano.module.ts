import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { ZanoPaymentService } from './services/zano-payment.service';
import { ZanoService } from './services/zano.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [ZanoService, ZanoPaymentService],
  exports: [ZanoService, ZanoPaymentService],
})
export class ZanoModule {}
