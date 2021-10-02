import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CryptoService } from './services/crypto.service';
import { TestController } from './test/test.controller';

@Module({
  imports: [SharedModule],
  providers: [CryptoService],
  exports: [CryptoService],
  controllers: [TestController],
})
export class AinModule {}
