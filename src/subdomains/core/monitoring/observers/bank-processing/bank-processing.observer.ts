import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BuyFiatRepository } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { BankTxReturnRepository } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.repository';
import { BankTxRepository } from 'src/subdomains/supporting/bank-tx/bank-tx/repositories/bank-tx.repository';
import { FiatOutputRepository } from 'src/subdomains/supporting/fiat-output/fiat-output.repository';
import { BankProcessingRuleResult, buildRuleSelections, mapRuleRow } from './bank-processing.query';
import { BANK_PROCESSING_BLOCKS, BANK_PROCESSING_RULES, BankProcessingBlockKey } from './bank-processing.rules';

export type BankProcessingData = BankProcessingRuleResult[];

@Injectable()
export class BankProcessingObserver extends MetricObserver<BankProcessingData> {
  protected readonly logger = new DfxLogger(BankProcessingObserver);

  constructor(
    monitoringService: MonitoringService,
    private readonly repos: RepositoryFactory,
  ) {
    super(monitoringService, 'bankProcessing', 'rules');
  }

  // Own process gate (BankProcessingMonitoring). Deliberately emits an empty/healthy snapshot every
  // 5 minutes — absence of the heartbeat is the "monitoring dead" signal; missing data must never
  // be read as "all ok".
  // The finite lock timeout is mandatory (an infinite lock would let one hung run block the job
  // silently forever); 1800s matches the sibling observers and keeps overlap unlikely at a 5-minute cadence.
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BANK_PROCESSING_MONITORING, timeout: 1800 })
  async fetch(): Promise<BankProcessingData> {
    const now = new Date();
    const results: BankProcessingRuleResult[] = [];

    // The six block queries run as separate statements, so the combined result is not one database
    // snapshot; a row moving between tables mid-run can appear in two rules for one cycle. Accepted:
    // rule tolerances are minutes to days, a single 5-minute cycle of skew cannot create a lasting
    // false overdue state.
    for (const block of Object.values(BANK_PROCESSING_BLOCKS)) {
      const rules = BANK_PROCESSING_RULES.filter((r) => r.block === block.key);
      const repo = this.repoFor(block.key);
      const { selects, params } = buildRuleSelections(block, rules, now);

      // TypeORM requires at least one select; pass selects one-by-one so AS aliases stay literal.
      const qb = repo.createQueryBuilder(block.alias).select(selects[0]);
      for (let i = 1; i < selects.length; i++) {
        qb.addSelect(selects[i]);
      }

      for (const join of block.joins) {
        if (join.target === 'relation') {
          if (!join.property) throw new Error(`Missing join property for block ${block.key}`);
          qb.leftJoin(join.property, join.alias);
        } else {
          qb.leftJoin(Fiat, join.alias, `${join.alias}."name" = ${block.alias}."currency"`);
        }
      }

      const raw = await qb.where(block.where).setParameters(params).getRawOne<Record<string, unknown>>();
      if (!raw) throw new Error(`Empty aggregation row for block ${block.key}`);
      results.push(...mapRuleRow(raw, rules, now));
    }

    this.emit(results);

    // Monitoring interface (Loki/Grafana/status-page parse these lines) — keep field names and
    // prefixes stable.
    const overdue = results.filter((r) => (r.overdueCount ?? 0) > 0).length;
    this.logger.verbose(`BankProcessing state snapshot: ${results.length} rule(s), ${overdue} overdue`);
    for (const result of results) {
      this.logger.verbose(`BankProcessing rule snapshot: ${JSON.stringify(result)}`);
    }

    return results;
  }

  private repoFor(
    key: BankProcessingBlockKey,
  ): BankTxRepository | BuyCryptoRepository | BuyFiatRepository | FiatOutputRepository | BankTxReturnRepository {
    switch (key) {
      case 'bankTx':
        return this.repos.bankTx;
      case 'buyCryptoFiat':
      case 'buyCryptoCrypto':
        return this.repos.buyCrypto;
      case 'buyFiat':
        return this.repos.buyFiat;
      case 'fiatOutput':
        return this.repos.fiatOutput;
      case 'bankTxReturn':
        return this.repos.bankTxReturn;
    }
  }
}
