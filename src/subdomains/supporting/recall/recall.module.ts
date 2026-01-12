import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankTxModule } from '../bank-tx/bank-tx.module';
import { FiatPayInModule } from '../fiat-payin/fiat-payin.module';
import { RecallController } from './recall.controller';
import { Recall } from './recall.entity';
import { RecallRepository } from './recall.repository';
import { RecallService } from './recall.service';

@Module({
  imports: [TypeOrmModule.forFeature([Recall]), SharedModule, UserModule, BankTxModule, FiatPayInModule],
  controllers: [RecallController],
  providers: [RecallRepository, RecallService],
  exports: [],
})
export class RecallModule {}
