import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { TransactionService } from '../payment/services/transaction.service';
import { CreateSupportIssueDto } from './dto/create-support-issue.dto';
import { UpdateSupportIssueDto } from './dto/update-support-issue.dto';
import { SupportIssue } from './support-issue.entity';
import { SupportIssueRepository } from './support-issue.repository';

@Injectable()
export class SupportIssueService {
  constructor(
    private readonly supportIssueRepo: SupportIssueRepository,
    private readonly transactionService: TransactionService,
    private readonly storageService: DocumentStorageService,
  ) {}

  async createSupportIssue(dto: CreateSupportIssueDto): Promise<SupportIssue> {
    const existing = await this.supportIssueRepo.findOneBy({
      transaction: { id: dto.transaction.id },
      reason: dto.reason,
    });
    if (existing) throw new BadRequestException('SupportIssue already exists');

    const entity = this.supportIssueRepo.create(dto);

    entity.transaction = await this.transactionService.getTransaction(dto.transaction.id, {
      buyCrypto: { buy: { user: true }, cryptoRoute: { user: true } },
      buyFiat: { sell: { user: true } },
    });
    if (!entity.transaction) throw new NotFoundException('Transaction not found');

    // upload document proof
    if (dto.file) {
      const { contentType, buffer } = Util.fromBase64(dto.file);

      entity.fileUrl = await this.storageService.uploadFile(
        entity.transaction.user.id,
        FileType.SUPPORT_ISSUE,
        `${Util.isoDateTime(new Date())}_support-issue_user-upload_${dto.fileName}`,
        buffer,
        contentType as ContentType,
      );
    }

    return this.supportIssueRepo.save(entity);
  }

  async updateSupportIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('SupportIssue not found');

    Object.assign(entity, dto);

    return this.supportIssueRepo.save(entity);
  }
}
