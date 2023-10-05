import { Module } from '@nestjs/common';
import { CheckoutService } from './services/checkout.service';

@Module({
  imports: [],
  controllers: [],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
