import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { RealUnitController } from './controllers/realunit.controller';
import { RealUnitClient } from './realunit-client';
import { RealUnitService } from './realunit.service';

@Module({
  imports: [SharedModule],
  controllers: [RealUnitController],
  providers: [RealUnitService, RealUnitClient],
  exports: [RealUnitService],
})
export class RealunitModule {}
