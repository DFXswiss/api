import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { KucoinPayService } from './kucoin-pay.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [KucoinPayService],
  exports: [KucoinPayService],
})
export class KucoinPayModule {}
