import { Util } from 'src/shared/utils/util';
import {
  BankProcessingBlock,
  BankProcessingBlockKey,
  BankProcessingRule,
  cutoffFor,
  toleranceMinutesFor,
} from './bank-processing.rules';

export interface RuleSelection {
  selects: string[]; // SQL expression AS alias; aliases: cnt_<idx>, chf_<idx>, ovd_<idx>, ovdchf_<idx>
  params: Record<string, Date>; // cutoff_<idx> -> cutoff date (only for rules with a tolerance)
}

export function buildRuleSelections(block: BankProcessingBlock, rules: BankProcessingRule[], now: Date): RuleSelection {
  const selects: string[] = [];
  const params: Record<string, Date> = {};

  rules.forEach((rule, i) => {
    // 'true' = the block WHERE is the whole condition -> SQL literal TRUE
    const cond = rule.condition === 'true' ? 'TRUE' : `(${rule.condition})`;

    selects.push(`SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS "cnt_${i}"`);
    selects.push(`SUM(CASE WHEN ${cond} THEN (${block.chfExpr}) ELSE 0 END) AS "chf_${i}"`);

    if (rule.tolerance !== null) {
      const ageCol = `${block.alias}."${rule.toleranceField}"`;
      selects.push(`SUM(CASE WHEN ${cond} AND ${ageCol} < :cutoff_${i} THEN 1 ELSE 0 END) AS "ovd_${i}"`);
      selects.push(
        `SUM(CASE WHEN ${cond} AND ${ageCol} < :cutoff_${i} THEN (${block.chfExpr}) ELSE 0 END) AS "ovdchf_${i}"`,
      );
      params[`cutoff_${i}`] = cutoffFor(rule, now)!;
    }
  });

  return { selects, params };
}

export interface BankProcessingRuleResult {
  key: string;
  block: BankProcessingBlockKey;
  label: string;
  count: number;
  chfSum: number; // rounded to 2 decimal places
  overdueCount: number | null; // null for display-only rules
  overdueChf: number | null;
  toleranceMinutes: number | null;
}

function requireFinite(value: number, ruleKey: string, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite aggregation value for rule "${ruleKey}" field "${field}"`);
  }
  return value;
}

export function mapRuleRow(
  raw: Record<string, unknown>,
  rules: BankProcessingRule[],
  now: Date,
): BankProcessingRuleResult[] {
  return rules.map((rule, i) => {
    const cntKey = `cnt_${i}`;
    // A missing cnt key means a query bug / wrong block — fail loud, no silent zero
    if (!(cntKey in raw)) {
      throw new Error(`Missing expected aggregation key "${cntKey}" in rule row`);
    }

    // SUM yields NULL for 0 matches (Postgres) — a legitimate empty value, not an error case
    const count = requireFinite(Number(raw[cntKey] ?? 0), rule.key, cntKey);
    const chfSum = Util.round(requireFinite(Number(raw[`chf_${i}`] ?? 0), rule.key, `chf_${i}`), 2);

    let overdueCount: number | null = null;
    let overdueChf: number | null = null;
    if (rule.tolerance !== null) {
      overdueCount = requireFinite(Number(raw[`ovd_${i}`] ?? 0), rule.key, `ovd_${i}`);
      overdueChf = Util.round(requireFinite(Number(raw[`ovdchf_${i}`] ?? 0), rule.key, `ovdchf_${i}`), 2);
    }

    return {
      key: rule.key,
      block: rule.block,
      label: rule.label,
      count,
      chfSum,
      overdueCount,
      overdueChf,
      toleranceMinutes: toleranceMinutesFor(rule, now),
    };
  });
}
