import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BerndCardanoController } from 'src/zzz-bernd/blockchain/bernd-cardano.controller';
import { CardanoService } from './services/cardano.service';

@Module({
  imports: [SharedModule],
  controllers: [BerndCardanoController],
  providers: [CardanoService],
  exports: [CardanoService],
})
export class CardanoModule {}
