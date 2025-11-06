import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { RealunitController } from './controllers/realunit.controller';
import { RealunitClient } from './realunit-client';
import { RealunitService } from './realunit.service';

@Module({
  imports: [SharedModule],
  controllers: [RealunitController],
  providers: [RealunitService, RealunitClient],
  exports: [RealunitService],
})
export class RealunitModule {}
