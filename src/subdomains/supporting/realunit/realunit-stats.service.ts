import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycContext, contextRequiredSteps } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRequestType } from '../payment/entities/transaction-request.entity';
import { TransactionService } from '../payment/services/transaction.service';
import { RealUnitKycFunnelStep, RealUnitStatsDto, RealUnitStatsPeriod } from './dto/realunit-stats.dto';
import { RealUnitService } from './realunit.service';

type KycStepCount = { name: KycStepName; status: ReviewStatus; count: number };
type TradingStat = { type: TransactionRequestType; volume: number; count: number };

const REGISTRATION_IN_REVIEW_STATUSES = [
  ReviewStatus.IN_PROGRESS,
  ReviewStatus.FINISHED,
  ReviewStatus.INTERNAL_REVIEW,
  ReviewStatus.EXTERNAL_REVIEW,
  ReviewStatus.MANUAL_REVIEW,
];
const COMPLETED_STATUSES = [ReviewStatus.COMPLETED];

@Injectable()
export class RealUnitStatsService implements OnModuleInit {
  private stats: RealUnitStatsDto;

  constructor(
    private readonly realUnitService: RealUnitService,
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly kycAdminService: KycAdminService,
    private readonly transactionService: TransactionService,
  ) {}

  onModuleInit() {
    void this.doUpdate();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.UPDATE_REALUNIT_STATS, timeout: 7200 })
  async doUpdate(): Promise<void> {
    const now = new Date();
    const d30 = Util.daysBefore(30, now);
    const d7 = Util.daysBefore(7, now);

    const asset = await this.realUnitService.getRealuAsset();
    const funnelSteps = Array.from(contextRequiredSteps(KycContext.REALUNIT_BUY) ?? []);
    const stepNames = [...funnelSteps, KycStepName.REALUNIT_REGISTRATION];

    const [
      accountsTotal,
      accounts30,
      accounts7,
      walletsTotal,
      wallets30,
      wallets7,
      stepsTotal,
      steps30,
      steps7,
      tradingTotal,
      trading30,
      trading7,
    ] = await Promise.all([
      this.userDataService.getNewUserDataCount(),
      this.userDataService.getNewUserDataCount(d30, now),
      this.userDataService.getNewUserDataCount(d7, now),
      this.userService.getNewUserCount(),
      this.userService.getNewUserCount(d30, now),
      this.userService.getNewUserCount(d7, now),
      this.kycAdminService.getKycStepCounts(stepNames),
      this.kycAdminService.getKycStepCounts(stepNames, d30, now),
      this.kycAdminService.getKycStepCounts(stepNames, d7, now),
      this.transactionService.getAssetTradingStats(asset.id),
      this.transactionService.getAssetTradingStats(asset.id, d30, now),
      this.transactionService.getAssetTradingStats(asset.id, d7, now),
    ]);

    this.stats = {
      updated: now,
      growth: {
        accounts: { total: accountsTotal, last30Days: accounts30, last7Days: accounts7 },
        wallets: { total: walletsTotal, last30Days: wallets30, last7Days: wallets7 },
      },
      kycFunnel: funnelSteps.map((step) => this.mapFunnelStep(step, stepsTotal, steps30, steps7)),
      registration: {
        started: this.stepPeriod(KycStepName.REALUNIT_REGISTRATION, stepsTotal, steps30, steps7),
        inReview: this.stepPeriod(
          KycStepName.REALUNIT_REGISTRATION,
          stepsTotal,
          steps30,
          steps7,
          REGISTRATION_IN_REVIEW_STATUSES,
        ),
        completed: this.stepPeriod(KycStepName.REALUNIT_REGISTRATION, stepsTotal, steps30, steps7, COMPLETED_STATUSES),
      },
      trading: {
        buyVolumeChf: this.tradingPeriod(TransactionRequestType.BUY, 'volume', tradingTotal, trading30, trading7),
        buyCount: this.tradingPeriod(TransactionRequestType.BUY, 'count', tradingTotal, trading30, trading7),
        sellVolumeChf: this.tradingPeriod(TransactionRequestType.SELL, 'volume', tradingTotal, trading30, trading7),
        sellCount: this.tradingPeriod(TransactionRequestType.SELL, 'count', tradingTotal, trading30, trading7),
      },
    };
  }

  getStats(): RealUnitStatsDto {
    return this.stats;
  }

  // --- Helpers ---

  private mapFunnelStep(
    step: KycStepName,
    total: KycStepCount[],
    last30: KycStepCount[],
    last7: KycStepCount[],
  ): RealUnitKycFunnelStep {
    return {
      step,
      reached: this.stepPeriod(step, total, last30, last7),
      completed: this.stepPeriod(step, total, last30, last7, COMPLETED_STATUSES),
    };
  }

  private stepPeriod(
    name: KycStepName,
    total: KycStepCount[],
    last30: KycStepCount[],
    last7: KycStepCount[],
    statuses?: ReviewStatus[],
  ): RealUnitStatsPeriod {
    return {
      total: this.sumStep(total, name, statuses),
      last30Days: this.sumStep(last30, name, statuses),
      last7Days: this.sumStep(last7, name, statuses),
    };
  }

  private sumStep(rows: KycStepCount[], name: KycStepName, statuses?: ReviewStatus[]): number {
    return rows
      .filter((r) => r.name === name && (!statuses || statuses.includes(r.status)))
      .reduce((sum, r) => sum + r.count, 0);
  }

  private tradingPeriod(
    type: TransactionRequestType,
    field: 'volume' | 'count',
    total: TradingStat[],
    last30: TradingStat[],
    last7: TradingStat[],
  ): RealUnitStatsPeriod {
    return {
      total: this.tradingValue(total, type, field),
      last30Days: this.tradingValue(last30, type, field),
      last7Days: this.tradingValue(last7, type, field),
    };
  }

  private tradingValue(rows: TradingStat[], type: TransactionRequestType, field: 'volume' | 'count'): number {
    const value = rows.find((r) => r.type === type)?.[field] ?? 0;
    return field === 'volume' ? Util.round(value, Config.defaultVolumeDecimal) : value;
  }
}
