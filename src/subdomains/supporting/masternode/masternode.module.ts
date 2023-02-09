import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { MasternodeController } from './masternode.controller';
import { MasternodeRepository } from './masternode.repository';
import { MasternodeService } from './masternode.service';

@Module({
  imports: [TypeOrmModule.forFeature([MasternodeRepository]), SharedModule],
  controllers: [MasternodeController],
  providers: [MasternodeService],
  exports: [MasternodeService],
})
export class MasternodeModule {}
