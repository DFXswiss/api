import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { Util } from 'src/shared/utils/util';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FindOptionsWhere, In, IsNull, MoreThan, Not } from 'typeorm';
import { TransactionService } from '../../payment/services/transaction.service';
import { CreateSupportIssueDto } from '../dto/create-support-issue.dto';
import { CreateSupportMessageDto } from '../dto/create-support-message.dto';
import { GetSupportIssueFilter } from '../dto/get-support-issue.dto';
import { SupportIssueDtoMapper } from '../dto/support-issue-dto.mapper';
import { SupportIssueDto, SupportMessageDto } from '../dto/support-issue.dto';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { SupportIssue, SupportIssueState } from '../entities/support-issue.entity';
import { CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';
import { LimitRequestService } from './limit-request.service';
import { SupportDocumentService } from './support-document.service';
import { SupportIssueNotificationService } from './support-issue-notification.service';

@Injectable()
export class SupportIssueService {
  private readonly UID_PREFIX = 'I';

  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly transactionService: TransactionService,
    private readonly documentService: SupportDocumentService,
    private readonly userDataService: UserDataService,
    private readonly messageRepo: SupportMessageRepository,
    private readonly supportIssueNotificationService: SupportIssueNotificationService,
    private readonly limitRequestService: LimitRequestService,
  ) {}

  async createIssue(userDataId: number, dto: CreateSupportIssueDto): Promise<SupportIssueDto> {
    // mail is required
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData.mail) throw new BadRequestException('Mail is missing');

    const newIssue = this.supportIssueRepo.create({ userData, ...dto });

    const existingIssue = await this.supportIssueRepo.findOne({
      where: {
        userData: { id: userDataId },
        type: newIssue.type,
        reason: newIssue.reason,
        transaction: { id: newIssue.transaction?.id ?? IsNull() },
        state: dto.limitRequest ? Not(SupportIssueState.COMPLETED) : undefined,
      },
      relations: { messages: true, transaction: true, limitRequest: true },
    });

    if (!existingIssue) {
      // create UID
      const hash = Util.createHash(newIssue.type + new Date() + Util.randomId()).toUpperCase();
      newIssue.uid = `${this.UID_PREFIX}${hash.slice(0, 16)}`;

      // map transaction
      if (dto.transaction) {
        if (dto.transaction.id) {
          newIssue.transaction = await this.transactionService.getTransactionById(dto.transaction.id, {
            user: { userData: true },
          });
          if (!newIssue.transaction) throw new NotFoundException('Transaction not found');
          if (!newIssue.transaction.user || newIssue.transaction.user.userData.id !== newIssue.userData.id)
            throw new ForbiddenException('You can only create support issue for your own transaction');
        }

        newIssue.additionalInformation = dto.transaction;
      }

      // create limit request
      if (dto.limitRequest) {
        newIssue.limitRequest = await this.limitRequestService.increaseLimitInternal(dto.limitRequest, userData);
      }
    }

    const entity = existingIssue ?? (await this.supportIssueRepo.save(newIssue));
    const supportMessage = await this.createMessageInternal(entity, dto);

    const issue = SupportIssueDtoMapper.mapSupportIssue(entity);
    issue.messages.push(supportMessage);

    return issue;
  }

  async updateIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Support issue not found');

    Object.assign(entity, dto);

    return this.supportIssueRepo.save(entity);
  }

  async createMessage(id: string, dto: CreateSupportMessageDto, userDataId?: number): Promise<SupportMessageDto> {
    const issue = await this.supportIssueRepo.findOneBy(this.getIssueSearch(id, userDataId));
    if (!issue) throw new NotFoundException('Support issue not found');

    return this.createMessageInternal(issue, { ...dto, author: CustomerAuthor });
  }

  async createMessageSupport(id: number, dto: CreateSupportMessageDto): Promise<SupportMessageDto> {
    const issue = await this.supportIssueRepo.findOneBy({ id });
    if (!issue) throw new NotFoundException('Support issue not found');

    return this.createMessageInternal(issue, dto);
  }

  async getIssues(userDataId: number): Promise<SupportIssueDto[]> {
    const issues = await this.supportIssueRepo.find({
      where: { userData: { id: userDataId } },
      relations: { transaction: true, limitRequest: true },
    });

    return issues.map(SupportIssueDtoMapper.mapSupportIssue);
  }

  async getIssue(id: string, query: GetSupportIssueFilter, userDataId?: number): Promise<SupportIssueDto> {
    const issue = await this.supportIssueRepo.findOne({
      where: this.getIssueSearch(id, userDataId),
      relations: { transaction: true, limitRequest: true },
    });
    if (!issue) throw new NotFoundException('Support issue not found');

    issue.messages = await this.messageRepo.findBy({
      issue: { id: issue.id },
      id: MoreThan(query.fromMessageId ?? 0),
    });

    return SupportIssueDtoMapper.mapSupportIssue(issue);
  }

  async getIssueFile(id: string, messageId: number, userDataId?: number): Promise<BlobContent> {
    const message = await this.messageRepo.findOneBy({ id: messageId, issue: this.getIssueSearch(id, userDataId) });
    if (!message) throw new NotFoundException('Message not found');

    return this.documentService.downloadFile(message.userData.id, message.issue.id, message.fileName);
  }

  async getUserIssues(
    userDataId: number,
  ): Promise<{ supportIssues: SupportIssue[]; supportMessages: SupportMessage[] }> {
    const supportIssues = await this.supportIssueRepo.find({
      where: { userData: { id: userDataId } },
      relations: { transaction: true, limitRequest: true },
    });
    return {
      supportIssues,
      supportMessages: await this.messageRepo.findBy({ issue: { id: In(supportIssues.map((i) => i.id)) } }),
    };
  }

  // --- HELPER METHODS --- //

  private async createMessageInternal(issue: SupportIssue, dto: CreateSupportMessageDto): Promise<SupportMessageDto> {
    if (!dto.author) throw new BadRequestException('Author for message is missing');

    const entity = this.messageRepo.create({ ...dto, issue });

    // upload document
    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      entity.fileUrl = await this.documentService.uploadUserFile(
        entity.userData.id,
        entity.issue.id,
        `${Util.isoDateTime(new Date())}_${dto.author?.toLowerCase() ?? 'support'}_${Util.randomId()}_${dto.fileName}`,
        buffer,
        contentType as ContentType,
      );
    }

    await this.messageRepo.save(entity);

    if (dto.author !== CustomerAuthor) await this.supportIssueNotificationService.newSupportMessage(entity);

    if (issue.state === SupportIssueState.COMPLETED) {
      const update = { state: SupportIssueState.PENDING };
      Object.assign(issue, update);
      await this.supportIssueRepo.update(issue.id, update);
    }

    return SupportIssueDtoMapper.mapSupportMessage(entity);
  }

  private getIssueSearch(id: string, userDataId?: number): FindOptionsWhere<SupportIssue> {
    if (id.startsWith(this.UID_PREFIX)) return { uid: id };
    if (userDataId) return { id: +id, userData: { id: userDataId } };

    throw new UnauthorizedException();
  }
}
