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
import { SettingService } from 'src/shared/models/setting/setting.service';
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
import {
  GetSupportIssueFilter,
  GetSupportIssueListFilter,
  ListOrderDirection,
  SupportIssueListOrderBy,
} from '../dto/get-support-issue.dto';
import { SupportIssueDtoMapper } from '../dto/support-issue-dto.mapper';
import {
  SupportIssueDto,
  SupportIssueInternalDataDto,
  SupportIssueListDto,
  SupportMessageDto,
} from '../dto/support-issue.dto';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { AutoResponder, CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { RoleDepartmentMap } from '../enums/department.enum';
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
    private readonly settingService: SettingService,
  ) {}

  async getSupportIssueClerks(): Promise<string[]> {
    const clerks = await this.settingService.getObj<string[]>('supportClerks', []);
    return clerks.length > 0 ? clerks : ['Support'];
  }

  async getSupportIssueCounts(role: UserRole): Promise<Record<SupportIssueInternalState, number>> {
    const qb = this.supportIssueRepo
      .createQueryBuilder('issue')
      .select('issue.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .groupBy('issue.state');

    const departmentByRole = RoleDepartmentMap[role];
    if (departmentByRole) qb.andWhere('issue.department = :department', { department: departmentByRole });

    const raw: { state: SupportIssueInternalState; count: string }[] = await qb.getRawMany();

    const counts = Object.values(SupportIssueInternalState).reduce(
      (acc, state) => ({ ...acc, [state]: 0 }),
      {} as Record<SupportIssueInternalState, number>,
    );
    for (const row of raw) counts[row.state] = +row.count;

    return counts;
  }

  async getSupportIssueActivity(since: Date | undefined, role: UserRole): Promise<{ count: number; latestAt?: Date }> {
    const departmentByRole = RoleDepartmentMap[role];

    const qb = this.messageRepo
      .createQueryBuilder('m')
      .innerJoin('m.issue', 'i')
      .select('COUNT(*)', 'count')
      .addSelect('MAX(m.created)', 'latestAt');
    if (since) qb.andWhere('m.created > :since', { since: since.toISOString() });
    if (departmentByRole) qb.andWhere('i.department = :department', { department: departmentByRole });

    const raw = await qb.getRawOne<{ count: string | number; latestAt: Date | null }>();
    return { count: +(raw?.count ?? 0), latestAt: raw?.latestAt ?? undefined };
  }

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
    // mail is required
    if (!userData.mail) throw new BadRequestException('Mail is missing');

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

  async closeIssue(id: string, userDataId?: number): Promise<SupportIssueDto> {
    const issue = await this.supportIssueRepo.findOne({
      where: this.getIssueSearch(id, userDataId),
      relations: { transaction: true, limitRequest: true },
    });
    if (!issue) throw new NotFoundException('Support issue not found');

    // idempotent: leave already-closed issues untouched (a new customer message reopens them via createMessageInternal)
    if (![SupportIssueInternalState.COMPLETED, SupportIssueInternalState.CANCELED].includes(issue.state)) {
      await this.supportLogService.createSupportLog(issue.userData, {
        type: SupportLogType.CUSTOMER,
        state: SupportIssueInternalState.COMPLETED,
        comment: 'Closed by customer',
        supportIssue: issue,
        supportIssueType: issue.type,
      });

      await this.supportIssueRepo.update(...issue.setState(SupportIssueInternalState.COMPLETED));
    }

    // load messages so the response matches GET /:id instead of claiming an empty thread
    issue.messages = await this.messageRepo.findBy({ issue: { id: issue.id } });

    return SupportIssueDtoMapper.mapSupportIssue(issue);
  }

  async updateIssue(id: number, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    const entity = await this.supportIssueRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Support issue not found');

    return this.updateIssueInternal(entity, dto);
  }

  async updateIssueInternal(entity: SupportIssue, dto: UpdateSupportIssueDto): Promise<SupportIssue> {
    await this.supportLogService.createSupportLog(entity.userData, {
      ...dto,
      supportIssue: entity,
      supportIssueType: dto.type,
      type: SupportLogType.SUPPORT,
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
    const departmentByRole = RoleDepartmentMap[role];
    if (departmentByRole) {
      where.department = departmentByRole;
    } else if (filter.department) {
      where.department = filter.department;
    }

    if (filter.type) where.type = filter.type;

    // server-side search: split query into terms, each term must match at least one field (AND between terms, OR between fields)
    const terms = (filter.query ?? '')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 10);

    const qb = this.supportIssueRepo.createQueryBuilder('issue');
    if (terms.length > 0) qb.leftJoin('issue.userData', 'userData');

    if (where.department) qb.andWhere('issue.department = :department', { department: where.department });
    if (filter.states?.length) qb.andWhere('issue.state IN (:...states)', { states: filter.states });
    if (where.type) qb.andWhere('issue.type = :type', { type: where.type });
    if (filter.clerk) qb.andWhere('issue.clerk = :clerk', { clerk: filter.clerk });
    if (filter.createdFrom) qb.andWhere('issue.created >= :createdFrom', { createdFrom: new Date(filter.createdFrom) });
    if (filter.createdTo) {
      const createdTo = new Date(filter.createdTo);
      // a date-only bound (no time component) means "on or before that day" → include the whole day
      if (!filter.createdTo.includes('T')) createdTo.setUTCHours(23, 59, 59, 999);
      qb.andWhere('issue.created <= :createdTo', { createdTo });
    }

    const termCount = Math.min(terms.length, 10);
    for (let i = 0; i < termCount; i++) {
      const param = `term${i}`;
      qb.andWhere(
        `(issue.name LIKE :${param} OR issue.uid LIKE :${param} OR issue.clerk LIKE :${param} OR userData.firstname LIKE :${param} OR userData.surname LIKE :${param} OR userData.organizationName LIKE :${param} OR EXISTS (SELECT 1 FROM support_message m WHERE m.issueId = issue.id AND m.message LIKE :${param}))`,
        { [param]: `%${terms[i]}%` },
      );
    }

    // whitelisted sort column + direction (tie-break on id for stable pagination)
    const orderBy = filter.orderBy ?? SupportIssueListOrderBy.CREATED;
    const orderDir = filter.orderDir ?? ListOrderDirection.DESC;
    qb.orderBy(`issue.${orderBy}`, orderDir);
    if (orderBy !== SupportIssueListOrderBy.CREATED) qb.addOrderBy('issue.id', orderDir);

    if (filter.take != null) {
      qb.take(filter.take);
      if (filter.skip != null) qb.skip(filter.skip);
    }

    const [issues, total] = await qb.getManyAndCount();

    const stats = await this.getMessageStats(issues.map((i) => i.id));

    return {
      data: issues.map((i) => SupportIssueDtoMapper.mapSupportIssueListItem(i, stats.get(i.id))),
      total,
    };
  }

  private async getMessageStats(
    issueIds: number[],
  ): Promise<Map<number, { count: number; lastDate?: Date; lastAuthor?: string }>> {
    if (issueIds.length === 0) return new Map();

    // batched to stay below SQL Server's 2100 parameter limit
    const rows = await Util.doInBatchesAndJoin(
      issueIds,
      (chunk): Promise<{ issueId: string; count: string; lastDate: Date | null; lastAuthor: string | null }[]> =>
        this.messageRepo
          .createQueryBuilder('m')
          .select('m.issueId', 'issueId')
          .addSelect('COUNT(*)', 'count')
          .addSelect(
            (sub) =>
              sub
                .select('m2.created')
                .from(SupportMessage, 'm2')
                .where('m2.issueId = m.issueId')
                .orderBy('m2.id', 'DESC')
                .limit(1),
            'lastDate',
          )
          .addSelect(
            (sub) =>
              sub
                .select('m2.author')
                .from(SupportMessage, 'm2')
                .where('m2.issueId = m.issueId')
                .orderBy('m2.id', 'DESC')
                .limit(1),
            'lastAuthor',
          )
          .where('m.issueId IN (:...ids)', { ids: chunk })
          .groupBy('m.issueId')
          .getRawMany(),
      1000,
    );

    return new Map(
      rows.map((r) => [
        +r.issueId,
        { count: +r.count, lastDate: r.lastDate ?? undefined, lastAuthor: r.lastAuthor ?? undefined },
      ]),
    );
  }

  async getIssueEntities(userDataId: number): Promise<SupportIssue[]> {
    return this.supportIssueRepo.find({
      where: { userData: { id: userDataId } },
      relations: { transaction: true, limitRequest: true, messages: true },
      loadEagerRelations: false,
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
        userData: { country: true, language: true },
        transaction: {
          user: { wallet: true },
          buyCrypto: { outputAsset: true, cryptoInput: { asset: true } },
          buyFiat: { outputAsset: true, cryptoInput: { asset: true } },
        },
        limitRequest: true,
      },
      loadEagerRelations: false,
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
