import { Module } from '@nestjs/common';
import { BlockscoutModule } from 'src/integration/blockchain/shared/blockscout/blockscout.module';
import { SharedModule } from 'src/shared/shared.module';
import { CitreaTestnetService } from './citrea-testnet.service';

@Module({
  imports: [SharedModule, BlockscoutModule],
  providers: [CitreaTestnetService],
  exports: [CitreaTestnetService],
})
export class CitreaTestnetModule {}
