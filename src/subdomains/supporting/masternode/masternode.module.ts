import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { MasternodeController } from './masternode.controller';
import { Masternode } from './masternode.entity';
import { MasternodeRepository } from './masternode.repository';
import { MasternodeService } from './masternode.service';

@Module({
  imports: [TypeOrmModule.forFeature([Masternode]), SharedModule],
  controllers: [MasternodeController],
  providers: [MasternodeRepository, MasternodeService],
  exports: [MasternodeService],
})
export class MasternodeModule {}
