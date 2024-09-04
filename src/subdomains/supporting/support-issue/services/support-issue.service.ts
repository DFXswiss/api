import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { Util } from 'src/shared/utils/util';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { In, Not } from 'typeorm';
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
import { SupportIssueNotificationService } from './support-issue-notification.service';

@Injectable()
export class SupportIssueService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly transactionService: TransactionService,
    private readonly storageService: DocumentStorageService,
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

    const existingIssue = await this.supportIssueRepo.findOneBy({
      userData: { id: userDataId },
      type: newIssue.type,
      information: newIssue.information,
      reason: newIssue.reason,
      state: Not(SupportIssueState.COMPLETED),
    });

    // transaction issues
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

    // limit request
    if (dto.limitRequest && !existingIssue)
      newIssue.limitRequest = await this.limitRequestService.increaseLimitInternal(dto.limitRequest, userData);

    const entity = existingIssue ?? (await this.supportIssueRepo.save(newIssue));

    await this.createSupportMessage(entity.id, { ...dto, author: CustomerAuthor }, userDataId);

    return this.getSupportIssue(userDataId, { type: entity.type, id: entity.id, lastMessages: 1 });
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

    // upload document proof
    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      entity.fileUrl = await this.storageService.uploadFile(
        entity.userData.id,
        FileType.SUPPORT_ISSUE,
        `${Util.isoDateTime(new Date())}_support-issue_user-upload_${dto.fileName}`,
        buffer,
        contentType as ContentType,
      );
    }

    await this.messageRepo.save(entity);

    if (dto.author !== CustomerAuthor) await this.supportIssueNotificationService.newSupportMessage(entity);

    return SupportIssueDtoMapper.mapSupportMessage(entity);
  }

  async getSupportIssue(userDataId: number, query: GetSupportIssueFilter): Promise<SupportIssueDto> {
    if (!query.type && !query.id) throw new BadRequestException('Type or id is required');

    const supportIssue = await this.supportIssueRepo.findOneBy({
      userData: { id: userDataId },
      type: query.type,
      id: query.id,
    });

    if (!supportIssue) throw new NotFoundException('Support issue not found');

    const messages = await this.messageRepo.findBy({ issue: { id: supportIssue.id } });
    supportIssue.messages =
      query.fromMessageId > 0
        ? messages.filter((m) => m.id > query.fromMessageId)
        : query.lastMessages > 0
        ? messages.slice(-query.lastMessages)
        : messages;

    return SupportIssueDtoMapper.mapSupportIssue(supportIssue);
  }

  async getSupportIssueFile(userDataId: number, name: string): Promise<BlobContent> {
    const allDocuments = await this.storageService.listUserFiles(userDataId);
    const document = allDocuments.find((d) => d.name.includes(name));
    if (!document) throw new NotFoundException('File not found');

    return this.storageService.downloadFile(userDataId, document.type, document.name);
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
