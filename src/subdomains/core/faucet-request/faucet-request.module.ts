import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { PayoutModule } from 'src/subdomains/supporting/payout/payout.module';
import { PricingModule } from 'src/subdomains/supporting/pricing/pricing.module';
import { FaucetRequestController } from './controller/faucet-request.controller';
import { FaucetRequest } from './entities/faucet-request.entity';
import { FaucetRequestRepository } from './repositories/faucet-request.repository';
import { FaucetRequestService } from './services/faucet-request.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FaucetRequest]),
    UserModule,
    SharedModule,
    BlockchainModule,
    PricingModule,
    PayoutModule,
  ],
  controllers: [FaucetRequestController],
  providers: [FaucetRequestService, FaucetRequestRepository],
  exports: [],
})
export class FaucetRequestModule {}
