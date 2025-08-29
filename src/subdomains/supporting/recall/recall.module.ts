import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { RecallController } from './recall.controller';
import { Recall } from './recall.entity';
import { RecallRepository } from './recall.repository';
import { RecallService } from './recall.service';

@Module({
  imports: [TypeOrmModule.forFeature([Recall]), SharedModule],
  controllers: [RecallController],
  providers: [RecallRepository, RecallService],
  exports: [],
})
export class RecallModule {}
