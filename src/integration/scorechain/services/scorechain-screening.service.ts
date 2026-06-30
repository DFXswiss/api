import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MoreThanOrEqual, Not } from 'typeorm';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import {
  ScorechainAnalysisType,
  ScorechainObjectType,
  ScoringAnalysisResponse,
  severityFromScore,
  toScorechainBlockchain,
} from '../dto/scorechain.dto';
import { ScorechainScreening, ScorechainScreeningContext } from '../entities/scorechain-screening.entity';
import { ScorechainScreeningRepository } from '../repositories/scorechain-screening.repository';
import { ScorechainService } from './scorechain.service';

interface ScreenParams {
  objectType: ScorechainObjectType;
  objectId: string;
  blockchain: Blockchain;
  analysisType: ScorechainAnalysisType;
  context: ScorechainScreeningContext;
}

export const ScorechainNotSupportedSeverity = 'NotSupported';
export const ScorechainNoCoverageSeverity = 'NoCoverage';

@Injectable()
export class ScorechainScreeningService {
  private readonly logger = new DfxLogger(ScorechainScreeningService);

  constructor(
    private readonly scorechain: ScorechainService,
    private readonly repo: ScorechainScreeningRepository,
  ) {}

  // --- PUBLIC SCREENING (synchronous gate) --- //

  // Deposit gate: screen the incoming transaction (crypto-in: sell-crypto / buy-crypto swap).
  async screenDepositTransaction(blockchain: Blockchain, txHash: string): Promise<ScorechainScreening> {
    return this.screen({
      objectType: ScorechainObjectType.TRANSACTION,
      objectId: txHash,
      blockchain,
      analysisType: ScorechainAnalysisType.INCOMING,
      context: ScorechainScreeningContext.DEPOSIT,
    });
  }

  // Withdrawal gate: screen the destination address before payout (crypto-out: buy-crypto).
  async screenWithdrawalAddress(blockchain: Blockchain, address: string): Promise<ScorechainScreening> {
    return this.screen({
      objectType: ScorechainObjectType.ADDRESS,
      objectId: address,
      blockchain,
      analysisType: ScorechainAnalysisType.OUTGOING,
      context: ScorechainScreeningContext.WITHDRAWAL,
    });
  }

  // Manual/admin on-demand scoring.
  async screenManual(
    blockchain: Blockchain,
    objectId: string,
    objectType: ScorechainObjectType,
    analysisType = ScorechainAnalysisType.ASSIGNED,
  ): Promise<ScorechainScreening> {
    return this.screen({ objectType, objectId, blockchain, analysisType, context: ScorechainScreeningContext.MANUAL });
  }

  // Advisory decision (spec §8): a screening is "high risk" → route the tx to manual review.
  // Scorechain scores run 1-100 where LOW = riskier (1=Critical … 100=No risk), so a score
  // BELOW the configured threshold is high risk. Fail-closed: an invalid signature, a missing
  // score, or an unscreenable chain is always treated as high risk (never a silent pass).
  isHighRisk(screening: ScorechainScreening): boolean {
    if (!screening.signatureValid) return true;
    if (screening.riskScore == null) return true;
    return screening.riskScore < Config.scorechain.riskThreshold;
  }

  // --- CORE --- //

  private async screen(params: ScreenParams): Promise<ScorechainScreening> {
    const cached = await this.getCached(params);
    if (cached) return cached;

    const scBlockchain = toScorechainBlockchain(params.blockchain);
    if (!scBlockchain) {
      this.logger.warn(`Scorechain does not support ${params.blockchain} — screening skipped (not a pass)`);
      return this.save(params, { signatureValid: false, severity: ScorechainNotSupportedSeverity });
    }

    await this.assertQuota();

    const { data, signatureValid } = await this.scorechain.scoringAnalysis({
      objectType: params.objectType,
      objectId: params.objectId,
      blockchain: scBlockchain,
      analysisType: params.analysisType,
    });

    // Scorechain returns lowestScore=100 (No risk) even when it holds NO data for the object
    // (every analysis section reports hasResult=false). A score without any backing analysis is
    // meaningless, so treat "no coverage" as unscreenable → high risk, never as a clean pass.
    if (!this.hasCoverage(data)) {
      this.logger.warn(
        `Scorechain returned no coverage for ${params.objectType} ${params.objectId} on ${params.blockchain} — treated as high risk (not a pass)`,
      );
      return this.save(params, { signatureValid, severity: ScorechainNoCoverageSeverity, raw: data });
    }

    return this.save(params, {
      signatureValid,
      riskScore: data?.lowestScore,
      severity: severityFromScore(data?.lowestScore),
      riskIndicators: data?.analysis,
      raw: data,
    });
  }

  // Coverage = at least one analysis section actually produced a result. Without it the provider's
  // lowestScore is a meaningless default (=100), so the gate must not trust it.
  private hasCoverage(data?: ScoringAnalysisResponse): boolean {
    return Object.values(data?.analysis ?? {}).some((analysis) => analysis?.hasResult === true);
  }

  private async getCached(params: ScreenParams): Promise<ScorechainScreening | undefined> {
    // A TRANSACTION verdict is bound to an immutable tx hash, so it stays valid for the full window.
    // ADDRESS/WALLET risk can change after a clean screen, so those verdicts expire quickly — never
    // serve a stale clean address verdict to a later withdrawal gate.
    const cacheMinutes =
      params.objectType === ScorechainObjectType.TRANSACTION
        ? Config.scorechain.cacheMinutes
        : Config.scorechain.addressCacheMinutes;

    return (
      (await this.repo.findOne({
        where: {
          objectType: params.objectType,
          objectId: params.objectId,
          blockchain: params.blockchain,
          analysisType: params.analysisType,
          // Never serve a record whose signature did not verify: a transient verification failure
          // (clock skew / key rotation) would otherwise pin the object to high-risk for the whole
          // cache window. Re-screen instead so the gate can self-heal once signatures verify again.
          signatureValid: true,
          created: MoreThanOrEqual(Util.minutesBefore(cacheMinutes)),
        },
        order: { created: 'DESC' },
      })) ?? undefined
    );
  }

  // Quota guard (spec §9): the API exposes no remaining-quota field, so we count our own
  // billable screenings for the current month. Fail-closed when the configured cap is hit.
  private async assertQuota(): Promise<void> {
    const limit = Config.scorechain.monthlyCheckLimit;
    if (!limit) return;

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const used = await this.repo.countBy({
      created: MoreThanOrEqual(monthStart),
      // NotSupported rows are saved without any API call (unsupported chain) → not billable, so a
      // flood of unsupported-chain screenings must not exhaust the paid monthly cap.
      severity: Not(ScorechainNotSupportedSeverity),
    });
    if (used >= limit) throw new ServiceUnavailableException('Scorechain monthly screening quota reached');
  }

  private async save(
    params: ScreenParams,
    result: {
      signatureValid: boolean;
      riskScore?: number;
      severity?: string;
      riskIndicators?: unknown;
      raw?: unknown;
    },
  ): Promise<ScorechainScreening> {
    const entity = this.repo.create({
      objectType: params.objectType,
      objectId: params.objectId,
      blockchain: params.blockchain,
      analysisType: params.analysisType,
      context: params.context,
      signatureValid: result.signatureValid,
      riskScore: result.riskScore,
      severity: result.severity,
    });
    entity.riskIndicatorData = result.riskIndicators;
    entity.rawResponseData = result.raw;

    return this.repo.save(entity);
  }
}
