import { buildRuleSelections, mapRuleRow } from '../bank-processing.query';
import { BankProcessingBlock, BankProcessingRule } from '../bank-processing.rules';

describe('bank-processing.query', () => {
  const miniBlock: BankProcessingBlock = {
    key: 'buyFiat',
    alias: 'bf',
    where: `bf."isComplete" = false`,
    joins: [],
    chfExpr: `bf."amountInChf"`,
  };

  const rulesWithAndWithoutTolerance: BankProcessingRule[] = [
    {
      key: 'with-tol',
      label: 'Mit Toleranz',
      block: 'buyFiat',
      condition: `bf."amlCheck" IS NULL`,
      tolerance: { type: 'fixed', minutes: 15 },
      toleranceField: 'created',
    },
    {
      key: 'display-only',
      label: 'Ohne Toleranz',
      block: 'buyFiat',
      condition: `bf."amlCheck" = 'Pass'`,
      tolerance: null,
    },
  ];

  const now = new Date('2026-08-12T08:00:00.000Z');

  describe('buildRuleSelections', () => {
    it('builds exact select strings and only cutoff params for rules with tolerance', () => {
      const result = buildRuleSelections(miniBlock, rulesWithAndWithoutTolerance, now);

      expect(result.selects).toEqual([
        `SUM(CASE WHEN (bf."amlCheck" IS NULL) THEN 1 ELSE 0 END) AS "cnt_0"`,
        `SUM(CASE WHEN (bf."amlCheck" IS NULL) THEN (bf."amountInChf") ELSE 0 END) AS "chf_0"`,
        `SUM(CASE WHEN (bf."amlCheck" IS NULL) AND bf."created" < :cutoff_0 THEN 1 ELSE 0 END) AS "ovd_0"`,
        `SUM(CASE WHEN (bf."amlCheck" IS NULL) AND bf."created" < :cutoff_0 THEN (bf."amountInChf") ELSE 0 END) AS "ovdchf_0"`,
        `SUM(CASE WHEN (bf."amlCheck" = 'Pass') THEN 1 ELSE 0 END) AS "cnt_1"`,
        `SUM(CASE WHEN (bf."amlCheck" = 'Pass') THEN (bf."amountInChf") ELSE 0 END) AS "chf_1"`,
      ]);

      expect(Object.keys(result.params)).toEqual(['cutoff_0']);
      expect(result.params.cutoff_0).toEqual(new Date(now.getTime() - 15 * 60 * 1000));
    });

    it("maps condition 'true' to SQL TRUE", () => {
      const trueRule: BankProcessingRule[] = [
        {
          key: 'all',
          label: 'Alles',
          block: 'buyFiat',
          condition: 'true',
          tolerance: null,
        },
      ];
      const result = buildRuleSelections(miniBlock, trueRule, now);
      expect(result.selects[0]).toBe(`SUM(CASE WHEN TRUE THEN 1 ELSE 0 END) AS "cnt_0"`);
      expect(result.selects[1]).toBe(`SUM(CASE WHEN TRUE THEN (bf."amountInChf") ELSE 0 END) AS "chf_0"`);
    });
  });

  describe('mapRuleRow', () => {
    it('coerces string SUMs, treats SUM NULL as 0, rounds CHF to 2 places, display-only overdue null', () => {
      const raw: Record<string, unknown> = {
        cnt_0: '3',
        chf_0: '12.345',
        ovd_0: '1',
        ovdchf_0: '4.5',
        cnt_1: null, // SUM yields NULL for 0 matches
        chf_1: null,
      };

      const mapped = mapRuleRow(raw, rulesWithAndWithoutTolerance, now);

      expect(mapped).toEqual([
        {
          key: 'with-tol',
          block: 'buyFiat',
          label: 'Mit Toleranz',
          count: 3,
          chfSum: 12.35,
          overdueCount: 1,
          overdueChf: 4.5,
          toleranceMinutes: 15,
        },
        {
          key: 'display-only',
          block: 'buyFiat',
          label: 'Ohne Toleranz',
          count: 0,
          chfSum: 0,
          overdueCount: null,
          overdueChf: null,
          toleranceMinutes: null,
        },
      ]);
    });

    it('rounds CHF half-cases with the repo-wide Util.round semantics', () => {
      // Util.round(x,2) divides as an IEEE-754 float BEFORE Math.round: 1.005/0.01 = 100.4999… → 100,
      // so 1.005 rounds DOWN to 1 (and -1.005 up to -1). This matches how every other CHF amount in
      // the repo is rounded; a half-cent deviation on a monitoring aggregate is accepted for parity.
      const rawPos: Record<string, unknown> = {
        cnt_0: 1,
        chf_0: 1.005,
        ovd_0: 0,
        ovdchf_0: 0,
        cnt_1: 0,
        chf_1: 0,
      };
      expect(mapRuleRow(rawPos, rulesWithAndWithoutTolerance, now)[0].chfSum).toBe(1);

      const rawNeg: Record<string, unknown> = {
        cnt_0: 1,
        chf_0: -1.005,
        ovd_0: 0,
        ovdchf_0: 0,
        cnt_1: 0,
        chf_1: 0,
      };
      expect(mapRuleRow(rawNeg, rulesWithAndWithoutTolerance, now)[0].chfSum).toBe(-1);
    });

    it('throws when an expected cnt key is missing', () => {
      const raw: Record<string, unknown> = {
        chf_0: '1',
        cnt_1: '0',
        chf_1: '0',
      };

      expect(() => mapRuleRow(raw, rulesWithAndWithoutTolerance, now)).toThrow(
        /Missing expected aggregation key "cnt_0"/,
      );
    });

    it('throws on non-finite raw values (NaN string)', () => {
      const raw: Record<string, unknown> = {
        cnt_0: 'NaN',
        chf_0: '0',
        ovd_0: '0',
        ovdchf_0: '0',
        cnt_1: '0',
        chf_1: '0',
      };

      expect(() => mapRuleRow(raw, rulesWithAndWithoutTolerance, now)).toThrow(
        /Non-finite aggregation value for rule "with-tol" field "cnt_0"/,
      );
    });

    it('throws on non-finite raw values (Infinity)', () => {
      const raw: Record<string, unknown> = {
        cnt_0: 1,
        chf_0: Infinity,
        ovd_0: 0,
        ovdchf_0: 0,
        cnt_1: 0,
        chf_1: 0,
      };

      expect(() => mapRuleRow(raw, rulesWithAndWithoutTolerance, now)).toThrow(
        /Non-finite aggregation value for rule "with-tol" field "chf_0"/,
      );
    });

    it('throws on a non-finite overdue count', () => {
      const raw: Record<string, unknown> = {
        cnt_0: 1,
        chf_0: 0,
        ovd_0: 'NaN',
        ovdchf_0: 0,
        cnt_1: 0,
        chf_1: 0,
      };

      expect(() => mapRuleRow(raw, rulesWithAndWithoutTolerance, now)).toThrow(
        /Non-finite aggregation value for rule "with-tol" field "ovd_0"/,
      );
    });

    it('throws on a non-finite overdue CHF sum', () => {
      const raw: Record<string, unknown> = {
        cnt_0: 1,
        chf_0: 0,
        ovd_0: 0,
        ovdchf_0: Infinity,
        cnt_1: 0,
        chf_1: 0,
      };

      expect(() => mapRuleRow(raw, rulesWithAndWithoutTolerance, now)).toThrow(
        /Non-finite aggregation value for rule "with-tol" field "ovdchf_0"/,
      );
    });
  });
});
