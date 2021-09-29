import { Module } from '@nestjs/common';
import { CryptoService } from './services/crypto.service';

@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class AinModule {}
