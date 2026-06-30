import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ScorechainController } from './controllers/scorechain.controller';
import { ScorechainWebhookController } from './controllers/scorechain-webhook.controller';
import { ScorechainScreening } from './entities/scorechain-screening.entity';
import { ScorechainScreeningRepository } from './repositories/scorechain-screening.repository';
import { ScorechainScreeningService } from './services/scorechain-screening.service';
import { ScorechainService } from './services/scorechain.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([ScorechainScreening])],
  controllers: [ScorechainController, ScorechainWebhookController],
  providers: [ScorechainService, ScorechainScreeningService, ScorechainScreeningRepository],
  exports: [ScorechainService, ScorechainScreeningService],
})
export class ScorechainModule {}
