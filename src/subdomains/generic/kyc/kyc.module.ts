import { Module } from '@nestjs/common';
import { DocumentStorageService } from './services/document-storage.service';

@Module({
  imports: [],
  controllers: [],
  providers: [DocumentStorageService],
  exports: [DocumentStorageService],
})
export class KycModule {}
