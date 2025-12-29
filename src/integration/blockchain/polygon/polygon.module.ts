import { Module } from '@nestjs/common';
import { AlchemyModule } from 'src/integration/alchemy/alchemy.module';
import { SharedModule } from 'src/shared/shared.module';
import { PolygonService } from './polygon.service';

@Module({
  imports: [SharedModule, AlchemyModule],
  controllers: [],
  providers: [PolygonService],
  exports: [PolygonService],
})
export class PolygonModule {}
