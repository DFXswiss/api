import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionService } from '../../payment/services/transaction.service';
import { CreateTransactionIssueDto } from '../dto/create-support-issue.dto';
import { CreateSupportMessageDto } from '../dto/create-support-message.dto';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { SupportIssue, SupportIssueType } from '../entities/support-issue.entity';
import { SupportMessageAuthor } from '../entities/support-message.entity';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';

@Injectable()
export class SupportIssueService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly transactionService: TransactionService,
    private readonly storageService: DocumentStorageService,
    private readonly userService: UserService,
    private readonly messageRepo: SupportMessageRepository,
  ) {}

  async createTransactionIssue(userId: number, transactionId: number, dto: CreateTransactionIssueDto): Promise<void> {
    const existing = await this.supportIssueRepo.findOneBy({
      transaction: { id: transactionId },
      reason: dto.reason,
    });
    if (existing) throw new ConflictException('There is already a support issue for this transaction');

    const user = await this.userService.getUser(userId, { userData: true });

    let entity = this.supportIssueRepo.create({ type: SupportIssueType.TRANSACTION_ISSUE, ...dto });

    entity.transaction = await this.transactionService.getTransactionById(transactionId, { user: { userData: true } });
    if (!entity.transaction) throw new NotFoundException('Transaction not found');
    if (!entity.transaction.user || entity.transaction.user.userData.id !== user.userData.id)
      throw new ForbiddenException('You can only create support issue for your own transaction');

    entity = await this.supportIssueRepo.save(entity);

    if (dto.message)
      await this.createSupportMessage(
        {
          author: SupportMessageAuthor.CUSTOMER,
          supportIssue: entity,
          ...dto,
        },
        userId,
      );
  }

  async updateSupportIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('SupportIssue not found');

    Object.assign(entity, dto);

    return this.supportIssueRepo.save(entity);
  }

  async createSupportMessage(dto: CreateSupportMessageDto, userId?: number): Promise<void> {
    const existing = await this.messageRepo.findOneBy({
      message: dto.message,
      supportIssue: { id: dto.supportIssue.id },
    });
    if (existing) throw new ConflictException('Support Message already exists');

    const entity = this.messageRepo.create(dto);

    entity.supportIssue = await this.supportIssueRepo.findOneBy({ id: dto.supportIssue.id });
    if (!entity.supportIssue) throw new NotFoundException('Support Issue not found');

    // upload document proof
    if (dto.file && userId) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      const user = await this.userService.getUser(userId, { userData: true });

      entity.fileUrl = await this.storageService.uploadFile(
        user.userData.id,
        FileType.SUPPORT_ISSUE,
        `${Util.isoDateTime(new Date())}_support-issue_user-upload_${dto.fileName}`,
        buffer,
        contentType as ContentType,
      );
    }

    await this.messageRepo.save(entity);
  }
}
