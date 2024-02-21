import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { BaseService } from './base.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  controllers: [],
  providers: [BaseService],
  exports: [BaseService],
})
export class BaseModule {}
