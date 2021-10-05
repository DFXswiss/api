import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CryptoService } from './services/crypto.service';
import { NodeController } from './node/node.controller';

@Module({
  imports: [SharedModule],
  providers: [CryptoService],
  exports: [CryptoService],
  controllers: [NodeController],
})
export class AinModule {}
