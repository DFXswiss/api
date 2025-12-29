import { Module } from '@nestjs/common';
import { ArweaveService } from './services/arweave.service';

@Module({
  imports: [],
  controllers: [],
  providers: [ArweaveService],
  exports: [ArweaveService],
})
export class ArweaveModule {}
