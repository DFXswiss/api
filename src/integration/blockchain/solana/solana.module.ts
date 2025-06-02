import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { SolanaService } from './services/solana.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [SolanaService],
  exports: [SolanaService],
})
export class SolanaModule {}
