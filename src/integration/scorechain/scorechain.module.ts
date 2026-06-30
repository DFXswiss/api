import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { ScorechainController } from './controllers/scorechain.controller';
import { ScorechainWebhookController } from './controllers/scorechain-webhook.controller';
import { ScorechainScreening } from './entities/scorechain-screening.entity';
import { ScorechainWebhookGuard } from './guards/scorechain-webhook.guard';
import { ScorechainScreeningRepository } from './repositories/scorechain-screening.repository';
import { ScorechainScreeningService } from './services/scorechain-screening.service';
import { ScorechainService } from './services/scorechain.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([ScorechainScreening])],
  controllers: [ScorechainController, ScorechainWebhookController],
  providers: [ScorechainService, ScorechainScreeningService, ScorechainScreeningRepository, ScorechainWebhookGuard],
  exports: [ScorechainService, ScorechainScreeningService],
})
export class ScorechainModule {}
