import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { CitreaTestnetService } from './citrea-testnet.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  providers: [CitreaTestnetService],
  exports: [CitreaTestnetService],
})
export class CitreaTestnetModule {}