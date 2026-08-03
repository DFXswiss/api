import {
  BANK_PROCESSING_BLOCKS,
  BANK_PROCESSING_RULES,
  BankProcessingRule,
  HOURLY_TOLERANCE_MINUTES,
  cutoffFor,
  dynamicToleranceMinutes,
} from '../bank-processing.rules';

describe('bank-processing.rules', () => {
  it('has unique rule keys', () => {
    const keys = BANK_PROCESSING_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requires toleranceField whenever tolerance is set', () => {
    for (const rule of BANK_PROCESSING_RULES) {
      if (rule.tolerance != null) {
        expect(rule.toleranceField).toBeDefined();
      }
    }
  });

  it('references only existing blocks', () => {
    for (const rule of BANK_PROCESSING_RULES) {
      expect(BANK_PROCESSING_BLOCKS[rule.block]).toBeDefined();
    }
  });

  it('HOURLY_TOLERANCE_MINUTES has exactly 24 entries', () => {
    expect(HOURLY_TOLERANCE_MINUTES).toHaveLength(24);
  });

  describe('dynamicToleranceMinutes', () => {
    // August = CEST (UTC+2): local Zurich time = UTC + 2h
    // January = CET (UTC+1): local Zurich time = UTC + 1h

    it('Wednesday 10:00 Europe/Zurich (summer) = 120', () => {
      // 2026-08-12 is Wednesday; 10:00 Zürich = 08:00Z
      expect(dynamicToleranceMinutes(new Date('2026-08-12T08:00:00.000Z'))).toBe(120);
    });

    it('Wednesday 03:00 Europe/Zurich (summer) = 900', () => {
      // 03:00 Zürich = 01:00Z
      expect(dynamicToleranceMinutes(new Date('2026-08-12T01:00:00.000Z'))).toBe(900);
    });

    it('Saturday 10:00 Europe/Zurich = 120 + 2160 = 2280', () => {
      // 2026-08-15 is Saturday; 10:00 Zürich = 08:00Z
      expect(dynamicToleranceMinutes(new Date('2026-08-15T08:00:00.000Z'))).toBe(2280);
    });

    it('Sunday 10:00 Europe/Zurich = 120 + 3600 = 3720', () => {
      // 2026-08-16 is Sunday; 10:00 Zürich = 08:00Z
      expect(dynamicToleranceMinutes(new Date('2026-08-16T08:00:00.000Z'))).toBe(3720);
    });

    it('Monday 06:00 Europe/Zurich (before 07:12) = 1080 + 5040 = 6120', () => {
      // 2026-08-10 is Monday; 06:00 Zürich = 04:00Z; HOURLY[6]=1080
      expect(dynamicToleranceMinutes(new Date('2026-08-10T04:00:00.000Z'))).toBe(6120);
    });

    it('Monday 08:00 Europe/Zurich (after 07:12) = 120', () => {
      // 08:00 Zürich = 06:00Z
      expect(dynamicToleranceMinutes(new Date('2026-08-10T06:00:00.000Z'))).toBe(120);
    });

    it('Wednesday 10:00 Europe/Zurich (winter CET) = 120', () => {
      // 2026-01-14 is Wednesday; 10:00 Zürich = 09:00Z
      expect(dynamicToleranceMinutes(new Date('2026-01-14T09:00:00.000Z'))).toBe(120);
    });
  });

  describe('cutoffFor', () => {
    const now = new Date('2026-08-12T08:00:00.000Z'); // Wed 10:00 Zurich

    it('returns null for display-only rules', () => {
      const rule: BankProcessingRule = {
        key: 'display',
        label: 'Display',
        block: 'bankTx',
        condition: 'true',
        tolerance: null,
      };
      expect(cutoffFor(rule, now)).toBeNull();
    });

    it('fixed 30 → now - 30 minutes', () => {
      const rule: BankProcessingRule = {
        key: 'fixed-30',
        label: 'Fixed',
        block: 'buyCryptoFiat',
        condition: `bc."amlCheck" IS NULL`,
        tolerance: { type: 'fixed', minutes: 30 },
        toleranceField: 'created',
      };
      expect(cutoffFor(rule, now)).toEqual(new Date(now.getTime() - 30 * 60 * 1000));
    });

    it('dynamic +120 on Wednesday 10:00 → now - 240 minutes', () => {
      // base 120 + offset 120 = 240
      const rule: BankProcessingRule = {
        key: 'dyn-120',
        label: 'Dynamic',
        block: 'fiatOutput',
        condition: `fo."remittanceInfo" IS NULL`,
        tolerance: { type: 'dynamic', offsetMinutes: 120 },
        toleranceField: 'updated',
      };
      expect(cutoffFor(rule, now)).toEqual(new Date(now.getTime() - 240 * 60 * 1000));
    });
  });
});
