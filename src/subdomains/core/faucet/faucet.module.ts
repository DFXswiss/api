import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { Faucet } from './entities/faucet.entity';
import { FaucetRepository } from './repositories/faucet.repository';
import { FaucetService } from './services/faucet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Faucet]),
    forwardRef(() => UserModule),
    SharedModule,
    BlockchainModule,
    PricingModule,
    PayoutModule,
  ],
  controllers: [],
  providers: [FaucetService, FaucetRepository],
  exports: [FaucetService],
})
export class FaucetModule {}
