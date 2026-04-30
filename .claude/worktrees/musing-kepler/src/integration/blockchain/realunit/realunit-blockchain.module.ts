import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { RealUnitBlockchainService } from './realunit-blockchain.service';

@Module({
  imports: [SharedModule],
  providers: [RealUnitBlockchainService],
  exports: [RealUnitBlockchainService],
})
export class RealUnitBlockchainModule {}
