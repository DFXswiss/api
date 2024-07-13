import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { In, Not } from 'typeorm';
import { TransactionService } from '../../payment/services/transaction.service';
import { CreateSupportIssueDto, CreateSupportIssueInternalDto } from '../dto/create-support-issue.dto';
import { CreateSupportMessageDto } from '../dto/create-support-message.dto';
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

    const existingIssue = await this.supportIssueRepo.existsBy({
      userData: { id: userData.id },
      type: newIssue.type,
      information: newIssue.information,
      reason: newIssue.reason,
      state: Not(SupportIssueState.COMPLETED),
    });

    if (!existingIssue) await this.supportIssueRepo.save(newIssue);
  }

  async createIssue(userDataId: number, dto: CreateSupportIssueDto): Promise<void> {
    // mail is required
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData.mail) throw new BadRequestException('Mail is missing');

    const newIssue = this.supportIssueRepo.create({ userData, ...dto });

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
    if (dto.limitRequest) await this.limitRequestService.increaseLimitInternal(dto.limitRequest, userData);

    const existingIssue = await this.supportIssueRepo.findOneBy({
      userData: { id: userDataId },
      type: newIssue.type,
      information: newIssue.information,
      reason: newIssue.reason,
      state: Not(SupportIssueState.COMPLETED),
    });

    const entity = existingIssue ?? (await this.supportIssueRepo.save(newIssue));

    await this.createSupportMessage(entity.id, { ...dto, author: CustomerAuthor }, userDataId);
  }

  async updateSupportIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Support issue not found');

    Object.assign(entity, dto);

    return this.supportIssueRepo.save(entity);
  }

  async createSupportMessage(id: number, dto: CreateSupportMessageDto, userDataId: number): Promise<void> {
    const existing = await this.messageRepo.findOneBy({
      message: dto.message,
      issue: { id },
    });
    if (existing) throw new ConflictException('Support message already exists');

    const entity = this.messageRepo.create(dto);

    entity.issue = await this.supportIssueRepo.findOne({
      where: { id },
      relations: { transaction: { user: { userData: true } } },
    });
    if (!entity.issue) throw new NotFoundException('Support issue not found');

    if (dto.author === CustomerAuthor && entity.userData.id !== userDataId)
      throw new ForbiddenException('You can only create support messages for your own transaction');

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
  }

  async getUserSupportTickets(
    userDataId: number,
  ): Promise<{ supportIssues: SupportIssue[]; supportMessages: SupportMessage[] }> {
    const supportIssues = await this.supportIssueRepo.findBy({ userData: { id: userDataId } });
    return {
      supportIssues,
      supportMessages: await this.messageRepo.findBy({ issue: { id: In(supportIssues.map((i) => i.id)) } }),
    };
  }
}
