import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { TronService } from './services/tron.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [TronService],
  exports: [TronService],
})
export class TronModule {}
