import { Module } from '@nestjs/common';
import { StarknetService } from './services/starknet.service';

@Module({
  controllers: [],
  providers: [StarknetService],
  exports: [StarknetService],
})
export class StarknetModule {}
