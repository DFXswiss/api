import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { IknaController } from './controllers/ikna.controller';
import { IknaService } from './services/ikna.service';

@Module({
  imports: [SharedModule],
  controllers: [IknaController],
  providers: [IknaService],
  exports: [],
})
export class IknaModule {}
