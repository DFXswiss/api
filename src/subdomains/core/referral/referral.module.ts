import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { RefController } from './process/ref.controller';
import { RefRepository } from './process/ref.repository';
import { RefService } from './process/ref.service';
import { RefRewardController } from './reward/ref-reward.controller';
import { RefRewardRepository } from './reward/ref-reward.repository';
import { RefRewardService } from './reward/ref-reward.service';

@Module({
  imports: [TypeOrmModule.forFeature([RefRepository, RefRewardRepository]), SharedModule, forwardRef(() => UserModule)],
  controllers: [RefController, RefRewardController],
  providers: [RefService, RefRewardService],
  exports: [RefService, RefRewardService],
})
export class ReferralModule {}
