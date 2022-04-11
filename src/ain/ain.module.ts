import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CryptoService } from './services/crypto.service';
import { NodeController } from './node/node.controller';
import { NodeService } from './node/node.service';
import { WhaleService } from './whale/whale.service';

@Module({
  imports: [SharedModule],
  providers: [CryptoService, NodeService, WhaleService],
  exports: [CryptoService, NodeService, WhaleService],
  controllers: [NodeController],
})
export class AinModule {}
