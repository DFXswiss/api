import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ScorechainController } from './controllers/scorechain.controller';
import { ScorechainScreening } from './entities/scorechain-screening.entity';
import { ScorechainScreeningRepository } from './repositories/scorechain-screening.repository';
import { ScorechainPdfService } from './services/scorechain-pdf.service';
import { ScorechainScreeningService } from './services/scorechain-screening.service';
import { ScorechainService } from './services/scorechain.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([ScorechainScreening])],
  controllers: [ScorechainController],
  providers: [ScorechainService, ScorechainScreeningService, ScorechainScreeningRepository, ScorechainPdfService],
  exports: [ScorechainService, ScorechainScreeningService, ScorechainPdfService],
})
export class ScorechainModule {}
