import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { SharedModule } from '../../../shared/shared.module';
import { TransactionModule } from '../payment/transaction.module';
import { SupportIssueController } from './support-issue.controller';
import { SupportIssue } from './support-issue.entity';
import { SupportIssueRepository } from './support-issue.repository';
import { SupportIssueService } from './support-issue.service';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([SupportIssue]), TransactionModule, KycModule],
  controllers: [SupportIssueController],
  providers: [SupportIssueRepository, SupportIssueService],
  exports: [SupportIssueService],
})
export class SupportIssueModule {}
