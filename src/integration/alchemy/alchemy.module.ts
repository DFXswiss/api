import { Module } from '@nestjs/common';
import { AlchemyController } from './controllers/alchemy.controller';
import { AlchemyService } from './services/alchemy.service';

@Module({
  imports: [],
  controllers: [AlchemyController],
  providers: [AlchemyService],
  exports: [AlchemyService],
})
export class AlchemyModule {}
