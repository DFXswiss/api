import { Module } from '@nestjs/common';
import { CryptoService } from './services/crypto.service';
import { TestController } from './test/test.controller';

@Module({
  providers: [CryptoService],
  exports: [CryptoService],
  controllers: [TestController],
})
export class AinModule {}
