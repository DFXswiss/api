import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycModule } from 'src/subdomains/generic/kyc/kyc.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { SharedModule } from '../../../shared/shared.module';
import { NotificationModule } from '../notification/notification.module';
import { PaymentModule } from '../payment/payment.module';
import { TransactionModule } from '../payment/transaction.module';
import { LimitRequest } from './entities/limit-request.entity';
import { SupportIssue } from './entities/support-issue.entity';
import { SupportMessage } from './entities/support-message.entity';
import { LimitRequestController } from './limit-request.controller';
import { LimitRequestRepository } from './repositories/limit-request.repository';
import { SupportIssueRepository } from './repositories/support-issue.repository';
import { SupportMessageRepository } from './repositories/support-message.repository';
import { LimitRequestNotificationService } from './services/limit-request-notification.service';
import { LimitRequestService } from './services/limit-request.service';
import { SupportDocumentService } from './services/support-document.service';
import { SupportIssueNotificationService } from './services/support-issue-notification.service';
import { SupportIssueService } from './services/support-issue.service';
import { SupportIssueController } from './support-issue.controller';

@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([SupportIssue, SupportMessage, LimitRequest]),
    TransactionModule,
    forwardRef(() => KycModule),
    forwardRef(() => UserModule),
    forwardRef(() => PaymentModule),
    NotificationModule,
  ],
  controllers: [SupportIssueController, LimitRequestController],
  providers: [
    SupportIssueRepository,
    SupportIssueService,
    SupportMessageRepository,
    SupportIssueNotificationService,
    LimitRequestService,
    LimitRequestRepository,
    LimitRequestNotificationService,
    SupportDocumentService,
  ],
  exports: [SupportIssueService, LimitRequestService],
})
export class SupportIssueModule {}
