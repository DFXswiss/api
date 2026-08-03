import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { MetricObserver } from 'src/subdomains/core/monitoring/metric.observer';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
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
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BANK_PROCESSING_MONITORING, timeout: 600 })
  async fetch(): Promise<BankProcessingData> {
    const now = new Date();
    const results: BankProcessingRuleResult[] = [];

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

      const raw = await qb.where(block.where).setParameters(params).getRawOne();
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

  private repoFor(key: BankProcessingBlockKey) {
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
