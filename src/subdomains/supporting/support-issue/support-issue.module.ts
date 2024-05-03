import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { SharedModule } from '../../../shared/shared.module';
import { TransactionModule } from '../payment/transaction.module';
import { SupportIssue } from './entities/support-issue.entity';
import { SupportMessage } from './entities/support-message.entity';
import { SupportIssueRepository } from './repositories/support-issue.repository';
import { SupportMessageRepository } from './repositories/support-message.repository';
import { SupportIssueService } from './services/support-issue.service';
import { SupportIssueController } from './support-issue.controller';

@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([SupportIssue, SupportMessage]),
    TransactionModule,
    KycModule,
    UserModule,
  ],
  controllers: [SupportIssueController],
  providers: [SupportIssueRepository, SupportIssueService, SupportMessageRepository],
  exports: [SupportIssueService],
})
export class SupportIssueModule {}
