import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { MoneroService } from './services/monero.service';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [MoneroService],
  exports: [MoneroService],
})
export class MoneroModule {}
