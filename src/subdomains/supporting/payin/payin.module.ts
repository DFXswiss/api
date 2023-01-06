import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/user/user.module';
import { PayInFactory } from './factories/payin.factory';
import { PayInRepository } from './repositories/payin.repository';
import { PayInService } from './services/payin.service';
import { DeFiChainStrategy } from './strategies/defichain.strategy';

@Module({
  imports: [TypeOrmModule.forFeature([PayInRepository]), BlockchainModule, SharedModule, UserModule],
  controllers: [],
  providers: [PayInService, DeFiChainStrategy, PayInFactory],
  exports: [PayInService],
})
export class PayInModule {}
