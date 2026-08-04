import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Config } from 'src/config/config';
import { BlobContent } from 'src/integration/infrastructure/storage/storage.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SupportClerkAccountDto } from 'src/shared/models/setting/dto/support-clerk-account.dto';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { resolveClientSource } from 'src/shared/utils/request-client';
import { Util } from 'src/shared/utils/util';
import { REALUNIT_WALLET_NAME } from 'src/subdomains/supporting/notification/realunit-mail-rules';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { PhoneCallStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
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
  SupportIssueStatisticsDto,
  SupportMessageDto,
} from '../dto/support-issue.dto';
import { UpdateSupportIssueDto } from '../dto/update-support-issue.dto';
import { SupportIssue } from '../entities/support-issue.entity';
import { AutoResponder, CustomerAuthor, SupportMessage } from '../entities/support-message.entity';
import { getVisibleDepartments } from '../enums/department.enum';
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
  private readonly logger = new DfxLogger(SupportIssueService);

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
    private readonly walletService: WalletService,
  ) {}

  async getSupportIssueClerks(): Promise<string[]> {
    const clerks = await this.settingService.getObj<string[]>('supportClerks', []);
    return clerks.length > 0 ? clerks : ['Support'];
  }

  async getRealUnitSupportClerks(): Promise<string[]> {
    const clerks = await this.settingService.getObj<string[]>('realUnitSupportClerks', []);
    return clerks.length > 0 ? clerks : ['Support'];
  }

  // Resolves the clerk name assigned to a support account via the `supportClerkAccounts`
  // setting ([{ account, name }]). Returns undefined if the account is unmapped.
  async getSupportIssueClerkForAccount(account: number): Promise<string | undefined> {
    const clerks = await this.settingService.getObj<SupportClerkAccountDto[]>('supportClerkAccounts', []);
    return clerks.find((c) => c.account === account)?.name;
  }

  async getSupportIssueCounts(
    role: UserRole,
    customerIds?: number[],
  ): Promise<Record<SupportIssueInternalState, number>> {
    const counts = Object.values(SupportIssueInternalState).reduce(
      (acc, state) => ({ ...acc, [state]: 0 }),
      {} as Record<SupportIssueInternalState, number>,
    );

    const departments = getVisibleDepartments(role);
    if (!customerIds && departments?.length === 0) return counts; // no department access
    if (customerIds && !customerIds.length) return counts; // fail-closed: empty customer scope

    const qb = this.supportIssueRepo
      .createQueryBuilder('issue')
      .select('issue.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .groupBy('issue.state');
    if (customerIds)
      qb.innerJoin('issue.userData', 'scopeUd').andWhere('scopeUd.id IN (:...customerIds)', { customerIds });
    else if (departments) qb.andWhere('issue.department IN (:...departments)', { departments });

    const raw: { state: SupportIssueInternalState; count: string }[] = await qb.getRawMany();
    for (const row of raw) counts[row.state] = +row.count;

    return counts;
  }

  async getSupportIssueActivity(
    since: Date | undefined,
    role: UserRole,
    customerIds?: number[],
  ): Promise<{ count: number; latestAt?: Date }> {
    const departments = getVisibleDepartments(role);
    if (!customerIds && departments?.length === 0) return { count: 0, latestAt: undefined }; // no department access
    if (customerIds && !customerIds.length) return { count: 0, latestAt: undefined }; // fail-closed: empty customer scope

    const qb = this.messageRepo
      .createQueryBuilder('m')
      .innerJoin('m.issue', 'i')
      .select('COUNT(*)', 'count')
      .addSelect('MAX(m.created)', 'latestAt');
    if (since) qb.andWhere('m.created > :since', { since: since.toISOString() });
    if (customerIds) qb.innerJoin('i.userData', 'scopeUd').andWhere('scopeUd.id IN (:...customerIds)', { customerIds });
    else if (departments) qb.andWhere('i.department IN (:...departments)', { departments });

    const raw = await qb.getRawOne<{ count: string | number; latestAt: Date | null }>();
    return { count: +(raw?.count ?? 0), latestAt: raw?.latestAt ?? undefined };
  }

  async getSupportIssueStatistics(
    role: UserRole,
    periodDays = 365,
    customerIds?: number[],
  ): Promise<SupportIssueStatisticsDto> {
    const departments = getVisibleDepartments(role);
    // guard against a non-numeric ?days reaching the clamp as NaN (which would propagate to an Invalid Date)
    const days = Number.isFinite(periodDays) ? Math.min(Math.max(Math.round(periodDays), 1), 366) : 365;
    const granularity: 'day' | 'month' = days <= 31 ? 'day' : 'month';

    // no department access: return an empty statistic without querying. An empty `departments` list would
    // otherwise reach the queries below, where `if (departments)` is truthy and expands to a degenerate
    // `IN ()` clause (the same fail-closed contract the counts / activity / list queries already follow).
    // A customer-scoped (RealUnit) caller bypasses the department gate but fail-closes on an empty scope.
    if ((!customerIds && departments?.length === 0) || (customerIds && !customerIds.length))
      return {
        periodDays: days,
        total: 0,
        avgMessages: 0,
        perDay: 0,
        granularity,
        trend: [],
        avgResolutionHours: 0,
        resolutionByType: [],
      };

    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // total tickets and message count within the period
    const totalQb = this.supportIssueRepo
      .createQueryBuilder('issue')
      .select('COUNT(*)', 'count')
      .where('issue.created >= :from', { from });
    if (customerIds)
      totalQb.innerJoin('issue.userData', 'scopeUd').andWhere('scopeUd.id IN (:...customerIds)', { customerIds });
    else if (departments) totalQb.andWhere('issue.department IN (:...departments)', { departments });
    const total = +((await totalQb.getRawOne<{ count: string }>())?.count ?? 0);

    const msgQb = this.messageRepo
      .createQueryBuilder('m')
      .innerJoin('m.issue', 'issue')
      .select('COUNT(*)', 'count')
      .where('issue.created >= :from', { from });
    if (customerIds)
      msgQb.innerJoin('issue.userData', 'scopeUd').andWhere('scopeUd.id IN (:...customerIds)', { customerIds });
    else if (departments) msgQb.andWhere('issue.department IN (:...departments)', { departments });
    const messages = +((await msgQb.getRawOne<{ count: string }>())?.count ?? 0);

    // trend buckets: always group by day in SQL (CAST avoids Postgres-incompatible date-part functions and
    // keeps the raw query alias-clean, see query-builder-alias.spec.ts), then bucket daily or monthly in JS
    const trendQb = this.supportIssueRepo
      .createQueryBuilder('issue')
      .select('CAST(issue.created AS DATE)', 'd')
      .addSelect('COUNT(*)', 'count')
      .where('issue.created >= :from', { from })
      .groupBy('CAST(issue.created AS DATE)');
    if (customerIds)
      trendQb.innerJoin('issue.userData', 'scopeUd').andWhere('scopeUd.id IN (:...customerIds)', { customerIds });
    else if (departments) trendQb.andWhere('issue.department IN (:...departments)', { departments });
    const dayRows = await trendQb.getRawMany<{ d: Date | string; count: string }>();

    // build keys from local date parts on both the rows and the bucket loop; the app and DB both run UTC,
    // so the row-date space and the loop-date space align and the trend sums to total
    const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

    const trend: { key: string; count: number }[] = [];
    if (granularity === 'day') {
      const map = new Map(dayRows.map((r) => [dayKey(new Date(r.d)), +r.count]));
      // anchor the first bucket to `from`'s calendar day (not a fixed day count), so the daily trend covers
      // every day a row can fall on and always sums to total
      const lastDay = new Date(now);
      lastDay.setHours(0, 0, 0, 0);
      const d = new Date(from);
      d.setHours(0, 0, 0, 0);
      while (d.getTime() <= lastDay.getTime()) {
        trend.push({ key: dayKey(d), count: map.get(dayKey(d)) ?? 0 });
        d.setDate(d.getDate() + 1);
      }
    } else {
      // roll the daily counts up into months
      const map = new Map<string, number>();
      for (const r of dayRows) {
        const key = monthKey(new Date(r.d));
        map.set(key, (map.get(key) ?? 0) + +r.count);
      }
      // span every calendar month the [from, now] window touches, so the trend always sums to total
      const monthSpan = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
      for (let i = monthSpan; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        trend.push({ key: monthKey(d), count: map.get(monthKey(d)) ?? 0 });
      }
    }

    // average resolution time per type for tickets completed within the period (the last-update
    // timestamp is the completion proxy). Computed in JS so the raw SQL stays free of bare
    // date-part identifiers (see query-builder-alias.spec.ts).
    const resolvedQb = this.supportIssueRepo
      .createQueryBuilder('issue')
      .select('issue.type', 'type')
      .addSelect('issue.created', 'created')
      .addSelect('issue.updated', 'updated')
      .where('issue.state = :completed', { completed: SupportIssueInternalState.COMPLETED })
      .andWhere('issue.updated >= :from', { from });
    if (customerIds)
      resolvedQb.innerJoin('issue.userData', 'scopeUd').andWhere('scopeUd.id IN (:...customerIds)', { customerIds });
    else if (departments) resolvedQb.andWhere('issue.department IN (:...departments)', { departments });
    const resolvedRows = await resolvedQb.getRawMany<{ type: string; created: Date; updated: Date }>();

    const resolutionStats = new Map<string, { sum: number; count: number }>();
    for (const r of resolvedRows) {
      const hours = (new Date(r.updated).getTime() - new Date(r.created).getTime()) / (60 * 60 * 1000);
      const e = resolutionStats.get(r.type) ?? { sum: 0, count: 0 };
      e.sum += hours;
      e.count += 1;
      resolutionStats.set(r.type, e);
    }
    const resolutionByType = Array.from(resolutionStats.entries())
      .map(([key, v]) => ({ key, avgHours: v.sum / v.count, count: v.count }))
      .sort((a, b) => b.count - a.count);
    const avgResolutionHours =
      resolvedRows.length > 0
        ? resolutionByType.reduce((sum, r) => sum + r.avgHours * r.count, 0) / resolvedRows.length
        : 0;

    return {
      periodDays: days,
      total,
      avgMessages: total > 0 ? messages / total : 0,
      perDay: total / days,
      granularity,
      trend,
      avgResolutionHours,
      resolutionByType,
    };
  }

  async createTransactionRequestIssue(dto: CreateSupportIssueBaseDto, client?: string): Promise<SupportIssueDto> {
    if (!dto?.transaction?.orderUid) throw new BadRequestException('JWT Token or quoteUid missing');
    const transactionRequest = await this.transactionRequestService.getTransactionRequestByUid(
      dto.transaction.orderUid,
      { user: { userData: true } },
    );
    if (!transactionRequest) throw new NotFoundException('TransactionRequest not found');

    return this.createIssueInternal(transactionRequest.userData, dto, await this.resolveSourceWallet(client));
  }

  // User-opened ticket: source app comes from the per-request X-Client header.
  async createIssue(userDataId: number, dto: CreateSupportIssueDto, client?: string): Promise<SupportIssueDto> {
    return this.createForUserData(userDataId, dto, await this.resolveSourceWallet(client));
  }

  // Support-tool-created ticket: the support tool is part of the DFX services app, so these tickets are
  // deterministically DFX-attributed (an exact property of the creating application, not a guess). A
  // dedicated method - rather than an omitted optional arg on createIssue - so the invariant cannot be
  // broken by a future caller forwarding a customer client header into the support path.
  async createIssueBySupport(userDataId: number, dto: CreateSupportIssueDto): Promise<SupportIssueDto> {
    return this.createForUserData(userDataId, dto, await this.walletService.getDefault());
  }

  private async createForUserData(
    userDataId: number,
    dto: CreateSupportIssueDto,
    sourceWallet: Wallet,
  ): Promise<SupportIssueDto> {
    const userData = await this.userDataService.getUserData(userDataId, { wallet: true });
    if (!userData) throw new NotFoundException('UserData not found');

    return this.createIssueInternal(userData, dto, sourceWallet);
  }

  // Mail-branding wallet for the app the ticket is opened from, from the per-request X-Client header
  // (never from the user's persisted wallet). Product decision (#3937): DFX is the default brand and only
  // the realunit-app client is RealUnit-branded; every other value - including a missing or unknown header
  // - defaults to DFX. The header is an advisory, client-supplied branding signal that grants no access
  // and gates nothing, so it must never reject a request: failing closed here would break every client
  // that does not send it (the DFX web app, third-party widget integrators, older bundles).
  private async resolveSourceWallet(client?: string): Promise<Wallet> {
    if (resolveClientSource(client) === 'RealUnit') {
      const wallet = await this.walletService.getByIdOrName(undefined, REALUNIT_WALLET_NAME);
      // Fail closed: without the RealUnit wallet the ticket cannot be attributed exactly, and rendering
      // it as DFX would be a wrong brand, not a fallback.
      if (!wallet)
        throw new ServiceUnavailableException(
          `RealUnit ticket source resolved but the '${REALUNIT_WALLET_NAME}' wallet is missing`,
        );
      return wallet;
    }

    return this.walletService.getDefault();
  }

  async createIssueInternal(
    userData: UserData,
    dto: CreateSupportIssueDto,
    sourceWallet: Wallet,
  ): Promise<SupportIssueDto> {
    // mail is required
    if (!userData.mail) throw new BadRequestException('Mail is missing');

    const newIssue = this.supportIssueRepo.create({ userData, wallet: sourceWallet, ...dto });

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

    // Dedup keeps the existing issue's attribution: the source is a property of the app the ticket was
    // originally opened from (NOT NULL since the backfill migration), so a follow-up message from another
    // app must not rebrand it. Legacy rows created before attribution existed were backfilled to DFX; if
    // one ever surfaces unattributed, upgrade it with the now-known exact source instead of guessing.
    if (existingIssue && !existingIssue.wallet) {
      existingIssue.wallet = sourceWallet;
      await this.supportIssueRepo.update(existingIssue.id, { wallet: sourceWallet });
    }

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
      // persist the state change first, so the audit log only ever reflects a committed transition
      await this.supportIssueRepo.update(...issue.setState(SupportIssueInternalState.COMPLETED));

      await this.supportLogService.createSupportLog(issue.userData, {
        type: SupportLogType.CUSTOMER,
        state: SupportIssueInternalState.COMPLETED,
        comment: 'Closed by customer',
        supportIssue: issue,
        supportIssueType: issue.type,
      });
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
    customerIds?: number[],
  ): Promise<{ data: SupportIssueListDto[]; total: number }> {
    // department filtering: the role defines the allowed departments, an explicit filter may narrow within them
    const allowedDepartments = getVisibleDepartments(role);
    if (!customerIds && allowedDepartments?.length === 0) return { data: [], total: 0 }; // no department access
    if (customerIds && !customerIds.length) return { data: [], total: 0 }; // fail-closed: empty customer scope

    const departments =
      filter.department && (!allowedDepartments || allowedDepartments.includes(filter.department))
        ? [filter.department]
        : allowedDepartments;

    const [issues, total] = await this.supportIssueRepo.findIssueList({
      departments,
      customerIds,
      states: filter.states,
      type: filter.type,
      clerk: filter.clerk,
      createdFrom: filter.createdFrom ? new Date(filter.createdFrom) : undefined,
      createdTo: this.parseCreatedTo(filter.createdTo),
      // server-side search: split query into terms, each term must match at least one field
      // (AND between terms, OR between fields)
      terms: (filter.query ?? '')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 10),
      orderBy: filter.orderBy ?? SupportIssueListOrderBy.CREATED,
      orderDir: filter.orderDir ?? ListOrderDirection.DESC,
      take: filter.take,
      skip: filter.skip,
    });

    const stats = await this.messageRepo.findStatsFor(issues.map((i) => i.id));

    return {
      data: issues.map((i) => SupportIssueDtoMapper.mapSupportIssueListItem(i, stats.get(i.id))),
      total,
    };
  }

  /** A date-only upper bound (no time component) means "on or before that day" — include the whole day. */
  private parseCreatedTo(createdTo?: string): Date | undefined {
    if (!createdTo) return undefined;

    const date = new Date(createdTo);
    if (!createdTo.includes('T')) date.setUTCHours(23, 59, 59, 999);

    return date;
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
    const issues = await this.supportIssueRepo.findIssuesForAccount(userDataId);

    return issues.map(SupportIssueDtoMapper.mapSupportIssue);
  }

  async getIssue(id: string, query: GetSupportIssueFilter, userDataId?: number): Promise<SupportIssueDto> {
    const issue = await this.supportIssueRepo.findIssueBy(this.getIssueSearch(id, userDataId));
    if (!issue) throw new NotFoundException('Support issue not found');

    issue.messages = await this.messageRepo.findThread(issue.id, query.fromMessageId ?? 0);

    return SupportIssueDtoMapper.mapSupportIssue(issue);
  }

  async getIssueData(id: number, role: UserRole, customerIds?: number[]): Promise<SupportIssueInternalDataDto> {
    const issue = await this.supportIssueRepo.findIssueData(id);
    if (!issue) throw new NotFoundException('Support issue not found');
    // customer scope (RealUnit): fail-closed 404 when the issue does not belong to a scoped customer (no existence leak)
    if (customerIds && !customerIds.includes(issue.userData?.id))
      throw new NotFoundException('Support issue not found');

    // DFX Support and RealUnit tenant staff must not see the DFX AML-internal limit request
    const hideLimitRequest = [UserRole.SUPPORT, UserRole.REALUNIT].includes(role);
    return SupportIssueDtoMapper.mapSupportIssueData(issue, hideLimitRequest);
  }

  // Returns an issue's message thread, optionally scoped to a customer set (RealUnit tenant boundary): fail-closed
  // 404 when the issue does not belong to a scoped customer (no existence leak). This lets RealUnit staff read
  // messages for their own tenant's issues by numeric issue id, with server-side membership enforcement, instead
  // of the shared uid-keyed public endpoint. `fromMessageId` returns only newer messages (incremental polling).
  async getIssueMessages(id: number, customerIds?: number[], fromMessageId?: number): Promise<SupportMessageDto[]> {
    const issue = await this.supportIssueRepo.findOne({
      where: { id },
      relations: { userData: true },
      loadEagerRelations: false,
    });
    if (!issue) throw new NotFoundException('Support issue not found');
    // customer scope (RealUnit): fail-closed 404 when the issue does not belong to a scoped customer (no existence leak)
    if (customerIds && !customerIds.includes(issue.userData?.id))
      throw new NotFoundException('Support issue not found');

    const messages = await this.messageRepo.findBy({ issue: { id }, id: MoreThan(fromMessageId ?? 0) });
    return messages.map(SupportIssueDtoMapper.mapSupportMessage);
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

  // Resolves the owning userData id of an issue by numeric id, so a caller can enforce a membership/tenant
  // boundary before a mutating or data call. Throws NotFound (no existence leak) when the issue or its owner is missing.
  async getIssueUserDataId(id: number): Promise<number> {
    const issue = await this.supportIssueRepo.findOne({
      where: { id },
      relations: { userData: true },
      loadEagerRelations: false,
    });
    if (!issue?.userData) throw new NotFoundException('Support issue not found');

    return issue.userData.id;
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

  // The issue (and related quote) UID is treated as a capability token: knowing it grants access without
  // an account, which is required for anonymous transaction-request issues. Access by numeric id is instead
  // scoped to the owning userData. Consumers (get/message/file/close) are therefore as sensitive as the UID —
  // keep it secret. Read more before widening this surface.
  private getIssueSearch(id: string, userDataId?: number): FindOptionsWhere<SupportIssue> {
    if (id.startsWith(Config.prefixes.issueUidPrefix)) return { uid: id };
    if (id.startsWith(Config.prefixes.quoteUidPrefix)) return { transactionRequest: { uid: id } };
    if (userDataId) {
      const numId = +id;
      if (!Number.isInteger(numId)) throw new BadRequestException('id must be an integer');
      return { id: numId, userData: { id: userDataId } };
    }

    throw new UnauthorizedException();
  }
}
