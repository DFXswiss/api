import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CardanoService } from './services/cardano.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [CardanoService],
  exports: [CardanoService],
})
export class CardanoModule {}
