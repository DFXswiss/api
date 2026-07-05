import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { In, MoreThanOrEqual, Not } from 'typeorm';
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
import {
  ScorechainScreening,
  ScorechainScreeningContext,
  ScorechainScreeningTriggerType,
} from '../entities/scorechain-screening.entity';
import { ScorechainObjectNotFoundException } from '../exceptions/scorechain-object-not-found.exception';
import { ScorechainScreeningRepository } from '../repositories/scorechain-screening.repository';
import { ScorechainService } from './scorechain.service';

interface ScreenParams {
  objectType: ScorechainObjectType;
  objectId: string;
  blockchain: Blockchain;
  analysisType: ScorechainAnalysisType;
  context: ScorechainScreeningContext;
  triggerType: ScorechainScreeningTriggerType;
}

export const ScorechainNotSupportedSeverity = 'NotSupported';
export const ScorechainNoCoverageSeverity = 'NoCoverage';
export const ScorechainNotFoundSeverity = 'NotFound';

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
      triggerType: ScorechainScreeningTriggerType.AUTOMATIC,
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
      triggerType: ScorechainScreeningTriggerType.AUTOMATIC,
    });
  }

  // Manual on-demand re-screen of a withdrawal/target address (e.g. re-running the check for an
  // existing buy-crypto). Always reaches the provider again, bypassing the address cache window that
  // screen() honours — the point of a re-trigger is a fresh verdict.
  async rescreenWithdrawalAddress(blockchain: Blockchain, address: string): Promise<ScorechainScreening> {
    return this.performScreening({
      objectType: ScorechainObjectType.ADDRESS,
      objectId: address,
      blockchain,
      analysisType: ScorechainAnalysisType.OUTGOING,
      context: ScorechainScreeningContext.WITHDRAWAL,
      triggerType: ScorechainScreeningTriggerType.MANUAL,
    });
  }

  // Manual/admin on-demand scoring.
  async screenManual(
    blockchain: Blockchain,
    objectId: string,
    objectType: ScorechainObjectType,
    analysisType = ScorechainAnalysisType.ASSIGNED,
  ): Promise<ScorechainScreening> {
    return this.screen({
      objectType,
      objectId,
      blockchain,
      analysisType,
      context: ScorechainScreeningContext.MANUAL,
      triggerType: ScorechainScreeningTriggerType.MANUAL,
    });
  }

  // Advisory decision (spec §8): a screening is "high risk" → route the tx to manual review.
  // Scorechain scores run 1-100 where LOW = riskier (1=Critical … 100=No risk), so a score
  // BELOW the configured threshold is high risk. Fail-closed: an invalid signature or a missing
  // score is treated as high risk (never a silent pass) — except for a withdrawal to an address
  // Scorechain has no data on (see below).
  isHighRisk(screening: ScorechainScreening): boolean {
    // A withdrawal targets the customer's destination address, which is almost always fresh (no
    // on-chain history), so "no coverage / not found" is the expected normal case, not a risk signal —
    // flagging it would route essentially every withdrawal to manual review. Only an actual score gates
    // a withdrawal. Deposits stay fail-closed: an unanalysable incoming tx can mask a dirty source.
    // NoCoverage is a signed 200 response, so trust it only if the signature verified — an unverifiable
    // reply (missing/misparsed pinned key or a tampered response) still fails closed. NotFound is an
    // inherently unsigned 404.
    if (
      screening.context === ScorechainScreeningContext.WITHDRAWAL &&
      ((screening.severity === ScorechainNoCoverageSeverity && screening.signatureValid) ||
        screening.severity === ScorechainNotFoundSeverity)
    ) {
      return false;
    }

    if (!screening.signatureValid) return true;
    if (screening.riskScore == null) return true;
    return screening.riskScore < Config.scorechain.riskThreshold;
  }

  // --- CORE --- //

  private async screen(params: ScreenParams): Promise<ScorechainScreening> {
    const cached = await this.getCached(params);
    if (cached) return cached;

    return this.performScreening(params);
  }

  // Runs the actual provider call and persists the verdict, WITHOUT consulting the cache. Shared by
  // the cached screen() path and by the manual re-trigger (rescreenWithdrawalAddress), which must
  // always reach the provider again regardless of a recent cached verdict.
  private async performScreening(params: ScreenParams): Promise<ScorechainScreening> {
    const scBlockchain = toScorechainBlockchain(params.blockchain);
    if (!scBlockchain) {
      this.logger.warn(`Scorechain does not support ${params.blockchain} — screening skipped (not a pass)`);
      return this.save(params, { signatureValid: false, severity: ScorechainNotSupportedSeverity });
    }

    await this.assertQuota();

    try {
      const { data, signatureValid } = await this.scorechain.scoringAnalysis({
        objectType: params.objectType,
        objectId: params.objectId,
        blockchain: scBlockchain,
        analysisType: params.analysisType,
      });

      // Scorechain returns lowestScore=100 (No risk) even when it holds NO data for the object
      // (every analysis section reports hasResult=false). A score without backing analysis is
      // meaningless: record it as NoCoverage and let isHighRisk decide by context (fail-closed high
      // risk for deposits; a pass for a fresh withdrawal address).
      if (!this.hasCoverage(data)) {
        this.logger.warn(
          `Scorechain returned no coverage for ${params.objectType} ${params.objectId} on ${params.blockchain}`,
        );
        return await this.save(params, { signatureValid, severity: ScorechainNoCoverageSeverity, raw: data });
      }

      return await this.save(params, {
        signatureValid,
        riskScore: data?.lowestScore,
        severity: severityFromScore(data?.lowestScore),
        riskIndicators: data?.analysis,
        raw: data,
      });
    } catch (e) {
      // Scorechain has no record of the object — e.g. a withdrawal target address that has never
      // appeared on-chain (404). This is an expected outcome, not a provider outage: record it as a
      // NotFound verdict instead of throwing. isHighRisk then decides by context (fail-closed high risk
      // for deposits; a pass for a fresh withdrawal address). Observable as a WARN + audit row instead
      // of a recurring ERROR, and excluded from the billable quota.
      if (e instanceof ScorechainObjectNotFoundException) {
        this.logger.warn(`Scorechain has no record of ${params.objectType} ${params.objectId} on ${params.blockchain}`);
        return this.save(params, { signatureValid: false, severity: ScorechainNotFoundSeverity });
      }
      throw e;
    }
  }

  // Coverage = at least one analysis section actually produced a result. Without it the provider's
  // lowestScore is a meaningless default (=100), so the gate must not trust it.
  private hasCoverage(data?: ScoringAnalysisResponse): boolean {
    return Object.values(data?.analysis ?? {}).some((analysis) => analysis?.hasResult === true);
  }

  private async getCached(params: ScreenParams): Promise<ScorechainScreening | undefined> {
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
          // A TRANSACTION verdict is bound to an immutable tx hash, so a verified screening stays valid
          // forever — reuse it with NO time bound so a given tx is sent to the provider at most once.
          // ADDRESS/WALLET risk is mutable, so those verdicts expire after addressCacheMinutes and
          // re-screen.
          ...(params.objectType !== ScorechainObjectType.TRANSACTION && {
            created: MoreThanOrEqual(Util.minutesBefore(Config.scorechain.addressCacheMinutes)),
          }),
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
      // Exclude the non-scored outcomes from the paid monthly cap: NotSupported makes no API call at
      // all, and NotFound is a 404 with no completed analysis — matching the pre-existing behavior
      // where a 404 threw before persisting and was therefore never counted.
      severity: Not(In([ScorechainNotSupportedSeverity, ScorechainNotFoundSeverity])),
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
      triggerType: params.triggerType,
      signatureValid: result.signatureValid,
      riskScore: result.riskScore,
      severity: result.severity,
    });
    entity.riskIndicatorData = result.riskIndicators;
    entity.rawResponseData = result.raw;

    return this.repo.save(entity);
  }
}
