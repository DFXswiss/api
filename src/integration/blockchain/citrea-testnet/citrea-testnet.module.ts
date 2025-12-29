import { Module } from '@nestjs/common';
import { GoldskyModule } from 'src/integration/goldsky/goldsky.module';
import { SharedModule } from 'src/shared/shared.module';
import { CitreaTestnetService } from './citrea-testnet.service';

@Module({
  imports: [SharedModule, GoldskyModule],
  providers: [CitreaTestnetService],
  exports: [CitreaTestnetService],
})
export class CitreaTestnetModule {}
