import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { Util } from 'src/shared/utils/util';
import { ContentType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { In, MoreThan, Not } from 'typeorm';
import { TransactionService } from '../../payment/services/transaction.service';
import { CreateSupportIssueDto, CreateSupportIssueInternalDto } from '../dto/create-support-issue.dto';
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
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly transactionService: TransactionService,
    private readonly documentService: SupportDocumentService,
    private readonly userDataService: UserDataService,
    private readonly messageRepo: SupportMessageRepository,
    private readonly supportIssueNotificationService: SupportIssueNotificationService,
    private readonly limitRequestService: LimitRequestService,
  ) {}

  async createIssueInternal(userData: UserData, dto: CreateSupportIssueInternalDto): Promise<void> {
    const newIssue = this.supportIssueRepo.create({ userData, ...dto });

    await this.supportIssueRepo.save(newIssue);
  }

  async createIssue(userDataId: number, dto: CreateSupportIssueDto): Promise<SupportIssueDto> {
    // mail is required
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData.mail) throw new BadRequestException('Mail is missing');

    const newIssue = this.supportIssueRepo.create({ userData, ...dto });

    const existingIssue = await this.supportIssueRepo.findOne({
      where: {
        userData: { id: userDataId },
        type: newIssue.type,
        information: newIssue.information,
        reason: newIssue.reason,
        state: Not(SupportIssueState.COMPLETED),
      },
      relations: { messages: true },
    });

    if (!existingIssue && dto.transaction) {
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

    if (!existingIssue && dto.limitRequest) {
      newIssue.limitRequest = await this.limitRequestService.increaseLimitInternal(dto.limitRequest, userData);
    }

    const entity = existingIssue ?? (await this.supportIssueRepo.save(newIssue));
    const supportMessage = await this.createSupportMessage(entity.id, { ...dto, author: CustomerAuthor }, userDataId);

    const supportIssue = SupportIssueDtoMapper.mapSupportIssue(entity);
    if (!supportIssue.messages) supportIssue.messages = [];
    supportIssue.messages.push(supportMessage);

    return supportIssue;
  }

  async updateSupportIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Support issue not found');

    Object.assign(entity, dto);

    return this.supportIssueRepo.save(entity);
  }

  async createSupportMessage(id: number, dto: CreateSupportMessageDto, userDataId: number): Promise<SupportMessageDto> {
    const entity = this.messageRepo.create(dto);

    entity.issue = await this.supportIssueRepo.findOne({
      where: { id },
      relations: { transaction: { user: { userData: true } } },
    });
    if (!entity.issue) throw new NotFoundException('Support issue not found');

    if (dto.author === CustomerAuthor && entity.userData.id !== userDataId)
      throw new ForbiddenException('You can only create support messages for your own support issue');

    // upload document
    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      entity.fileUrl = await this.documentService.uploadFile(
        entity.userData.id,
        entity.issue.id,
        `${Util.isoDateTime(new Date())}_${dto.author?.toLowerCase() ?? 'support'}_${Util.randomId()}_${dto.fileName}`,
        buffer,
        contentType as ContentType,
      );
    }

    await this.messageRepo.save(entity);

    if (dto.author !== CustomerAuthor) await this.supportIssueNotificationService.newSupportMessage(entity);

    return SupportIssueDtoMapper.mapSupportMessage(entity);
  }

  async getSupportIssue(userDataId: number, id: number, query: GetSupportIssueFilter): Promise<SupportIssueDto> {
    const supportIssue = await this.supportIssueRepo.findOneBy({
      userData: { id: userDataId },
      id: id,
    });

    if (!supportIssue) throw new NotFoundException('Support issue not found');

    supportIssue.messages = await this.messageRepo.findBy({
      issue: { id: supportIssue.id },
      id: MoreThan(query.fromMessageId ?? 0),
    });

    return SupportIssueDtoMapper.mapSupportIssue(supportIssue);
  }

  async getSupportIssueFile(userDataId: number, id: number, messageId: number): Promise<BlobContent> {
    const message = await this.messageRepo.findOneBy({ id: messageId, issue: { id } });
    if (!message) throw new NotFoundException('Message not found');

    return this.documentService.downloadFile(userDataId, id, message.fileName);
  }

  async getUserSupportTickets(
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
}
