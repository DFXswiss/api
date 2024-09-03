import { SupportIssue } from '../entities/support-issue.entity';
import { SupportMessage } from '../entities/support-message.entity';
import { FileDto, SupportIssueDto, SupportMessageDto } from './support-issue.dto';

export class SupportIssueDtoMapper {
  static mapSupportIssue(supportIssue: SupportIssue): SupportIssueDto {
    const dto: SupportIssueDto = {
      id: supportIssue.id,
      state: supportIssue.state,
      type: supportIssue.type,
      reason: supportIssue.reason,
      name: supportIssue.name,
      created: supportIssue.created,
      information: supportIssue.information,
      transaction: supportIssue.transaction,
      messages: supportIssue.messages.map(SupportIssueDtoMapper.mapSupportMessage),
      limitRequest: supportIssue.limitRequest,
    };

    return Object.assign(new SupportIssueDto(), dto);
  }

  private static mapSupportMessage(supportMessage: SupportMessage): SupportMessageDto {
    const dto: SupportMessageDto = {
      id: supportMessage.id,
      author: supportMessage.author,
      created: supportMessage.created,
      message: supportMessage.message,
      file: supportMessage.fileUrl && SupportIssueDtoMapper.mapFile(supportMessage.fileUrl),
    };

    return Object.assign(new SupportMessageDto(), dto);
  }

  private static mapFile(fileUrl: string): FileDto {
    const dto: FileDto = {
      url: fileUrl,
      name: fileUrl.split('/').pop(),
      size: 0,
      type: 'application/pdf',
    };

    return Object.assign(new FileDto(), dto);
  }
}
