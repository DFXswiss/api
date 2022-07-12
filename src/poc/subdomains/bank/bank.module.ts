import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { BuyModule } from '../buy/buy.module';
import { BankBotService } from './services/bank-bot.service';

@Module({
  imports: [CqrsModule, BuyModule],
  controllers: [],
  providers: [BankBotService],
  exports: [],
})
export class BankModule {}
