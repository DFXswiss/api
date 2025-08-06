import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CitreaTestnetService } from './citrea-testnet.service';

@Module({
  imports: [SharedModule],
  providers: [CitreaTestnetService],
  exports: [CitreaTestnetService],
})
export class CitreaTestnetModule {}