import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { PhoneCallStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { FindOptionsWhere, In, IsNull, MoreThan, Not } from 'typeorm';
import { TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { TransactionSourceType } from '../../payment/entities/transaction.entity';
import { TransactionRequestService } from '../../payment/services/transaction-request.service';
import { TransactionService } from '../../payment/services/transaction.service';
import { CreateSupportIssueBaseDto, CreateSupportIssueDto } from '../dto/create-support-issue.dto';
import { CreateSupportMessageDto } from '../dto/create-support-message.dto';
import { GetSupportIssueFilter, GetSupportIssueListFilter } from '../dto/get-support-issue.dto';
import { SupportIssueDtoMapper } from '../dto/support-issue-dto.mapper';
import {
  SupportIssueDto,
  SupportIssueInternalDataDto,
  SupportIssueListDto,
  SupportMessageDto,
} from '../dto/support-issue.dto';
import { Department } from '../enums/department.enum';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { AutoResponder, CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { SupportIssueInternalState, SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { SupportLogType } from '../enums/support-log.enum';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportMessageRepository } from '../repositories/support-message.repository';
import { LimitRequestService } from './limit-request.service';
import { SupportDocumentService } from './support-document.service';
import { SupportIssueNotificationService } from './support-issue-notification.service';
import { SupportLogService } from './support-log.service';

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
    private readonly transactionRequestService: TransactionRequestService,
    private readonly supportLogService: SupportLogService,
    private readonly bankDataService: BankDataService,
  ) {}

  async createTransactionRequestIssue(dto: CreateSupportIssueBaseDto): Promise<SupportIssueDto> {
    if (!dto?.transaction?.orderUid) throw new BadRequestException('JWT Token or quoteUid missing');
    const transactionRequest = await this.transactionRequestService.getTransactionRequestByUid(
      dto.transaction.orderUid,
      { user: { userData: true } },
    );
    if (!transactionRequest) throw new NotFoundException('TransactionRequest not found');

    return this.createIssueInternal(transactionRequest.userData, dto);
  }

  async createIssue(userDataId: number, dto: CreateSupportIssueDto): Promise<SupportIssueDto> {
    const userData = await this.userDataService.getUserData(userDataId, { wallet: true });
    if (!userData) throw new NotFoundException('UserData not found');

    return this.createIssueInternal(userData, dto);
  }

  async createIssueInternal(userData: UserData, dto: CreateSupportIssueDto): Promise<SupportIssueDto> {
    const newIssue = this.supportIssueRepo.create({ userData, ...dto });

    const existingWhere: FindOptionsWhere<SupportIssue> = {
      userData: { id: userData.id },
      type: dto.type,
      reason: dto.reason,
      state: dto.limitRequest ? Not(SupportIssueInternalState.COMPLETED) : undefined,
    };

    if (dto.transaction?.id || dto.transaction?.uid?.startsWith(Config.prefixes.transactionUidPrefix)) {
      existingWhere.transaction = { id: dto.transaction?.id, uid: dto.transaction?.uid };
    } else if (dto.transaction?.orderUid || dto.transaction?.uid?.startsWith(Config.prefixes.quoteUidPrefix)) {
      existingWhere.transactionRequest = { uid: dto.transaction?.orderUid ?? dto.transaction?.uid };
    } else {
      existingWhere.transaction = { id: IsNull() };
      existingWhere.transactionRequest = { id: IsNull() };
    }

    const existingIssue = await this.supportIssueRepo.findOne({
      where: existingWhere,
      relations: { messages: true, limitRequest: true, userData: { wallet: true } },
    });

    if (!existingIssue) {
      // create UID
      newIssue.uid = Util.createUid(Config.prefixes.issueUidPrefix);

      // map transaction
      if (dto.transaction) {
        if (dto.transaction.id || dto.transaction.uid?.startsWith(Config.prefixes.transactionUidPrefix)) {
          newIssue.transaction = dto.transaction.id
            ? await this.transactionService.getTransactionById(dto.transaction.id, { userData: true })
            : await this.transactionService.getTransactionByUid(dto.transaction.uid, { userData: true });

          if (!newIssue.transaction) throw new NotFoundException('Transaction not found');
          if (!newIssue.transaction.userData || newIssue.transaction.userData.id !== newIssue.userData.id)
            throw new ForbiddenException('You can only create support issue for your own transaction');
        } else if (dto.transaction.orderUid || dto.transaction.uid?.startsWith(Config.prefixes.quoteUidPrefix)) {
          newIssue.transactionRequest = await this.transactionRequestService.getTransactionRequestByUid(
            dto.transaction.orderUid ?? dto.transaction.uid,
            { user: { userData: true }, transaction: true },
          );

          if (!newIssue.transactionRequest) throw new NotFoundException('Quote not found');
          if (
            !newIssue.transactionRequest.user ||
            newIssue.transactionRequest.user.userData.id !== newIssue.userData.id
          )
            throw new ForbiddenException('You can only create support issue for your own quote');

          if (newIssue.transactionRequest.transaction) newIssue.transaction = newIssue.transactionRequest.transaction;
        }

        newIssue.additionalInformation = dto.transaction;

        // Create user bankData
        if (
          dto.transaction.senderIban &&
          (newIssue.transaction?.sourceType === TransactionSourceType.BANK_TX ||
            newIssue.transactionRequest?.type === TransactionRequestType.BUY)
        ) {
          try {
            await this.bankDataService.createIbanForUserInternal(userData, { iban: dto.transaction.senderIban }, false);
          } catch (_) {
            // Skip errors from creating user bankData
          }
        }
      }

      // create limit request
      if (dto.limitRequest)
        newIssue.limitRequest = await this.limitRequestService.increaseLimitInternal(dto.limitRequest, userData);

      if (
        !userData.phoneCallStatus &&
        dto.type === SupportIssueType.VERIFICATION_CALL &&
        [SupportIssueReason.REJECT_CALL, SupportIssueReason.REPEAT_CALL].includes(dto.reason)
      ) {
        await this.userDataService.updateUserDataInternal(userData, {
          phoneCallStatus:
            dto.reason === SupportIssueReason.REJECT_CALL
              ? PhoneCallStatus.USER_REJECTED
              : dto.reason === SupportIssueReason.REPEAT_CALL
                ? PhoneCallStatus.REPEAT
                : undefined,
        });
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

    return this.updateIssueInternal(entity, dto);
  }

  async updateIssueInternal(entity: SupportIssue, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    await this.supportLogService.createSupportLog(entity.userData, {
      type: SupportLogType.SUPPORT,
      supportIssue: entity,
      ...dto,
    });

    await this.supportIssueRepo.update(entity.id, { state: dto.state, clerk: dto.clerk, department: dto.department });

    return Object.assign(entity, dto);
  }

  async createMessage(id: string, dto: CreateSupportMessageDto, userDataId?: number): Promise<SupportMessageDto> {
    const issue = await this.supportIssueRepo.findOne({
      where: this.getIssueSearch(id, userDataId),
      relations: { userData: { wallet: true } },
    });
    if (!issue) throw new NotFoundException('Support issue not found');

    return this.createMessageInternal(issue, { ...dto, author: CustomerAuthor });
  }

  async createMessageSupport(issueId: number, dto: CreateSupportMessageDto): Promise<SupportMessageDto> {
    const issue = await this.supportIssueRepo.findOne({
      where: { id: issueId },
      relations: { userData: { wallet: true } },
    });
    if (!issue) throw new NotFoundException('Support issue not found');

    return this.createMessageInternal(issue, dto);
  }

  async getSupportIssueList(
    filter: GetSupportIssueListFilter,
    role: UserRole,
  ): Promise<{ data: SupportIssueListDto[]; total: number }> {
    const where: FindOptionsWhere<SupportIssue> = {};

    // department filtering based on role
    const roleDepartmentMap: Partial<Record<UserRole, Department>> = {
      [UserRole.SUPPORT]: Department.SUPPORT,
      [UserRole.COMPLIANCE]: Department.COMPLIANCE,
      [UserRole.MARKETING]: Department.MARKETING,
    };

    const departmentByRole = roleDepartmentMap[role];
    if (departmentByRole) {
      where.department = departmentByRole;
    } else if (filter.department) {
      where.department = filter.department;
    }

    if (filter.state) where.state = filter.state;
    if (filter.type) where.type = filter.type;

    // server-side search: split query into terms, each term must match at least one field (AND between terms, OR between fields)
    const terms = (filter.query ?? '')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 10);

    const qb = this.supportIssueRepo
      .createQueryBuilder('issue')
      .leftJoinAndSelect('issue.messages', 'messages')
      .leftJoinAndSelect('issue.userData', 'userData');

    if (where.department) qb.andWhere('issue.department = :department', { department: where.department });
    if (where.state) qb.andWhere('issue.state = :state', { state: where.state });
    if (where.type) qb.andWhere('issue.type = :type', { type: where.type });

    const termCount = Math.min(terms.length, 10);
    for (let i = 0; i < termCount; i++) {
      const param = `term${i}`;
      qb.andWhere(
        `(issue.name LIKE :${param} OR issue.uid LIKE :${param} OR issue.clerk LIKE :${param} OR userData.firstname LIKE :${param} OR userData.surname LIKE :${param} OR userData.organizationName LIKE :${param} OR EXISTS (SELECT 1 FROM support_message m WHERE m.issueId = issue.id AND m.message LIKE :${param}))`,
        { [param]: `%${terms[i]}%` },
      );
    }

    qb.orderBy('issue.created', 'DESC');

    if (filter.take != null) {
      qb.take(filter.take);
      if (filter.skip != null) qb.skip(filter.skip);
    }

    const [issues, total] = await qb.getManyAndCount();

    return { data: issues.map(SupportIssueDtoMapper.mapSupportIssueListItem), total };
  }

  async getIssueEntities(userDataId: number): Promise<SupportIssue[]> {
    return this.supportIssueRepo.find({
      where: { userData: { id: userDataId } },
      relations: { transaction: true, limitRequest: true, messages: true },
      order: { created: 'DESC' },
    });
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

  async getIssueData(id: number, role: UserRole): Promise<SupportIssueInternalDataDto> {
    const issue = await this.supportIssueRepo.findOne({
      where: { id },
      relations: {
        transaction: {
          user: { wallet: true },
          buyCrypto: { transaction: true, cryptoInput: true },
          buyFiat: { transaction: true, cryptoInput: true },
        },
        limitRequest: true,
      },
    });
    if (!issue) throw new NotFoundException('Support issue not found');

    return SupportIssueDtoMapper.mapSupportIssueData(issue, role);
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

  async createMessageInternal(issue: SupportIssue, dto: CreateSupportMessageDto): Promise<SupportMessageDto> {
    if (!dto.author) throw new BadRequestException('Author for message is missing');
    if (!dto.message && !dto.file) throw new BadRequestException('Message or file is required');
    if (dto.message?.length > 4000) throw new BadRequestException('Message has too many characters');

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

    if (dto.author !== CustomerAuthor) {
      await this.supportIssueRepo.update(...issue.setClerk(dto.author));
      await this.supportIssueNotificationService.newSupportMessage(entity);
    } else if (issue.clerk === AutoResponder) {
      await this.supportIssueRepo.update(...issue.setClerk(null));
    }

    if (
      [
        SupportIssueInternalState.COMPLETED,
        SupportIssueInternalState.ON_HOLD,
        SupportIssueInternalState.CANCELED,
      ].includes(issue.state)
    )
      await this.supportIssueRepo.update(...issue.setState(SupportIssueInternalState.PENDING));

    return SupportIssueDtoMapper.mapSupportMessage(entity);
  }

  private getIssueSearch(id: string, userDataId?: number): FindOptionsWhere<SupportIssue> {
    if (id.startsWith(Config.prefixes.issueUidPrefix)) return { uid: id };
    if (id.startsWith(Config.prefixes.quoteUidPrefix)) return { transactionRequest: { uid: id } };
    if (userDataId) return { id: +id, userData: { id: userDataId } };

    throw new UnauthorizedException();
  }
}
