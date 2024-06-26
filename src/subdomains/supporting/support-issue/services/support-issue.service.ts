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
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { In, Not } from 'typeorm';
import { TransactionService } from '../../payment/services/transaction.service';
import { CreateSupportIssueDto } from '../dto/create-support-issue.dto';
import { CreateSupportMessageDto } from '../dto/create-support-message.dto';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { SupportIssue, SupportIssueState } from '../entities/support-issue.entity';
import { CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';
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
  ) {}

  async createIssue(userDataId: number, dto: CreateSupportIssueDto): Promise<void> {
    let entity = await this.create(userDataId, dto);

    if (dto.transaction) {
      if (dto.transaction.id) {
        entity.transaction = await this.transactionService.getTransactionById(dto.transaction.id, {
          user: { userData: true },
        });
        if (!entity.transaction) throw new NotFoundException('Transaction not found');
        if (!entity.transaction.user || entity.transaction.user.userData.id !== entity.userData.id)
          throw new ForbiddenException('You can only create support issue for your own transaction');
      }

      entity.additionalInformation = dto.transaction;
    }

    entity = await this.supportIssueRepo.save(entity);

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

  // --- HELPER METHODS --- //
  private async create(userDataId: number, dto: CreateSupportIssueDto): Promise<SupportIssue> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData.mail) throw new BadRequestException('Mail is missing');

    const existing = await this.supportIssueRepo.exists({
      where: {
        userData: { id: userDataId },
        type: dto.type,
        transaction: { id: dto.transaction?.id },
        reason: dto.reason,
        state: Not(SupportIssueState.COMPLETED),
      },
    });
    if (existing) throw new ConflictException('There is already a pending support issue');

    return this.supportIssueRepo.create({ userData, ...dto });
  }
}
