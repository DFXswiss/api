import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { MrosController } from './mros.controller';
import { Mros } from './mros.entity';
import { MrosRepository } from './mros.repository';
import { MrosService } from './mros.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mros]), SharedModule, UserModule],
  controllers: [MrosController],
  providers: [MrosRepository, MrosService],
  exports: [],
})
export class MrosModule {}
