import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { TransactionService } from '../payment/services/transaction.service';
import { CreateTransactionIssueDto } from './dto/create-support-issue.dto';
import { UpdateSupportIssueDto } from './dto/update-support-issue.dto';
import { SupportIssue, SupportIssueType } from './support-issue.entity';
import { SupportIssueRepository } from './support-issue.repository';

@Injectable()
export class SupportIssueService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly transactionService: TransactionService,
    private readonly storageService: DocumentStorageService,
  ) {}

  async createTransactionIssue(
    userDataId: number,
    transactionId: number,
    dto: CreateTransactionIssueDto,
  ): Promise<void> {
    const existing = await this.supportIssueRepo.findOneBy({
      transaction: { id: transactionId },
      reason: dto.reason,
    });
    if (existing) throw new ConflictException('There is already a support issue for this transaction');

    const entity = this.supportIssueRepo.create({ type: SupportIssueType.TRANSACTION_ISSUE, ...dto });

    entity.transaction = await this.transactionService.getTransactionById(transactionId, { user: { userData: true } });
    if (!entity.transaction) throw new NotFoundException('Transaction not found');
    if (!entity.transaction.user || entity.transaction.user.userData.id !== userDataId)
      throw new ForbiddenException('You can only create support issue for your own transaction');

    // upload document proof
    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      entity.fileUrl = await this.storageService.uploadFile(
        userDataId,
        FileType.SUPPORT_ISSUE,
        `${Util.isoDateTime(new Date())}_support-issue_user-upload_${dto.fileName}`,
        buffer,
        contentType as ContentType,
      );
    }

    await this.supportIssueRepo.save(entity);
  }

  async updateSupportIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('SupportIssue not found');

    Object.assign(entity, dto);

    return this.supportIssueRepo.save(entity);
  }
}
