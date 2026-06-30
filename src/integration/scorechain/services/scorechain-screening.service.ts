import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MoreThanOrEqual } from 'typeorm';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { ScorechainAnalysisType, ScorechainObjectType, toScorechainBlockchain } from '../dto/scorechain.dto';
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

  // Advisory decision (spec §8): a result at/above the configured threshold, an invalid
  // signature, or an unscreenable chain is "high risk" → route the tx to manual review.
  // Fail-closed: never treat an unknown/failed screening as a pass.
  isHighRisk(screening: ScorechainScreening): boolean {
    if (!screening.signatureValid) return true;
    if (screening.riskScore == null) return true;
    return screening.riskScore >= Config.scorechain.riskThreshold;
  }

  // --- CORE --- //

  private async screen(params: ScreenParams): Promise<ScorechainScreening> {
    const cached = await this.getCached(params);
    if (cached) return cached;

    const scBlockchain = toScorechainBlockchain(params.blockchain);
    if (!scBlockchain) {
      this.logger.warn(`Scorechain does not support ${params.blockchain} — screening skipped (not a pass)`);
      return this.save(params, { signatureValid: false, severity: 'NotSupported' });
    }

    await this.assertQuota();

    const { data, signatureValid } = await this.scorechain.scoringAnalysis({
      objectType: params.objectType,
      objectId: params.objectId,
      blockchain: scBlockchain,
      analysisType: params.analysisType,
    });

    return this.save(params, {
      signatureValid,
      riskScore: data?.score,
      severity: data?.severity,
      riskIndicators: data?.riskIndicators,
      raw: data,
    });
  }

  private async getCached(params: ScreenParams): Promise<ScorechainScreening | undefined> {
    return (
      (await this.repo.findOne({
        where: {
          objectType: params.objectType,
          objectId: params.objectId,
          blockchain: params.blockchain,
          analysisType: params.analysisType,
          created: MoreThanOrEqual(Util.daysBefore(1)),
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
    const used = await this.repo.countBy({ created: MoreThanOrEqual(monthStart) });
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
