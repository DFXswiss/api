import { Transaction } from '../../payment/entities/transaction.entity';
import { LimitRequest } from '../entities/limit-request.entity';
import { SupportIssue } from '../entities/support-issue.entity';
import { SupportMessage } from '../entities/support-message.entity';
import {
  SupportIssueDto,
  SupportIssueLimitRequestDto,
  SupportIssueTransactionDto,
  SupportMessageDto,
} from './support-issue.dto';

export class SupportIssueDtoMapper {
  static mapSupportIssue(supportIssue: SupportIssue): SupportIssueDto {
    const dto: SupportIssueDto = {
      uid: supportIssue.uid,
      state: supportIssue.state,
      type: supportIssue.type,
      reason: supportIssue.reason,
      name: supportIssue.name,
      created: supportIssue.created,
      transaction: SupportIssueDtoMapper.mapTransaction(supportIssue.transaction),
      messages: supportIssue.messages?.map(SupportIssueDtoMapper.mapSupportMessage) ?? [],
      limitRequest: SupportIssueDtoMapper.mapLimitRequest(supportIssue.limitRequest),
    };

    return Object.assign(new SupportIssueDto(), dto);
  }

  static mapSupportMessage(supportMessage: SupportMessage): SupportMessageDto {
    const dto: SupportMessageDto = {
      id: supportMessage.id,
      author: supportMessage.author,
      created: supportMessage.created,
      message: supportMessage.message,
      fileName: supportMessage.fileName,
    };

    return Object.assign(new SupportMessageDto(), dto);
  }

  static mapTransaction(transaction: Transaction): SupportIssueTransactionDto {
    if (!transaction?.id) return null;

    return {
      uid: transaction.uid,
      url: transaction.url,
    };
  }

  static mapLimitRequest(limitRequest: LimitRequest): SupportIssueLimitRequestDto {
    if (!limitRequest) return null;

    return {
      id: limitRequest.id,
      limit: limitRequest.limit,
    };
  }
}
