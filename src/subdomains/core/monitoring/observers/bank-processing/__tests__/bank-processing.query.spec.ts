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
        cnt_1: null, // SUM bei 0 Treffern
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
  });
});
