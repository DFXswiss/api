import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycStep } from './entities/kyc-step.entity';
import { DocumentStorageService } from './services/document-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycStep])],
  controllers: [],
  providers: [DocumentStorageService],
  exports: [DocumentStorageService],
})
export class KycModule {}
