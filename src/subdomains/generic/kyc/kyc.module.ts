import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../user/user.module';
import { KycController } from './api/kyc.controller';
import { KycStep } from './entities/kyc-step.entity';
import { DocumentStorageService } from './services/integration/document-storage.service';
import { IntrumService } from './services/integration/intrum.service';
import { KycService } from './services/kyc.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycStep]), forwardRef(() => UserModule)],
  controllers: [KycController],
  providers: [KycService, DocumentStorageService, IntrumService],
  exports: [DocumentStorageService],
})
export class KycModule {}
