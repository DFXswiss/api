import { Util } from 'src/shared/utils/util';
import { CryptoInput, PayInAction, PayInStatus } from '../crypto-input.entity';

describe('CryptoInput return-fee logic', () => {
  describe('#calcReturnSendAmount(...)', () => {
    it('binds to the authorized amount on a partial refund', () => {
      // maxSendable = 100 - 2 * 1.05 = 97.9; min(19, 97.9) = 19
      expect(CryptoInput.calcReturnSendAmount(100, 19, 2, 1.05, 12)).toBe(19);
    });

    it('binds to the gross-minus-fee cap on a full refund so the customer bears the live fee', () => {
      // maxSendable = 100 - 2 * 1.05 = 97.9; min(99, 97.9) = 97.9
      expect(CryptoInput.calcReturnSendAmount(100, 99, 2, 1.05, 12)).toBe(97.9);
    });

    it('reduces the send amount when the fee spikes above the authorized amount', () => {
      // maxSendable = 100 - 50 * 1.05 = 47.5; min(99, 47.5) = 47.5
      expect(CryptoInput.calcReturnSendAmount(100, 99, 50, 1.05, 12)).toBe(47.5);
    });

    it('returns 0 when the buffered fee is not economic (fee >= amount)', () => {
      // maxSendable = 10 - 10 * 1.05 = -0.5; max(-0.5, 0) = 0
      expect(CryptoInput.calcReturnSendAmount(10, 10, 10, 1.05, 12)).toBe(0);
    });

    it('handles a zero fee (partial and full)', () => {
      expect(CryptoInput.calcReturnSendAmount(100, 50, 0, 1.05, 12)).toBe(50);
      expect(CryptoInput.calcReturnSendAmount(100, 100, 0, 1.05, 12)).toBe(100);
    });

    it('rounds the result to the given decimals', () => {
      // maxSendable = 10 - 1/3 = 9.6666...; rounded to 2 decimals = 9.67
      expect(CryptoInput.calcReturnSendAmount(10, 10, 1 / 3, 1, 2)).toBe(9.67);
    });

    it('returns the boundary value when authorized equals the cap', () => {
      // maxSendable = 100 - 2 * 1 = 98; min(98, 98) = 98
      expect(CryptoInput.calcReturnSendAmount(100, 98, 2, 1, 12)).toBe(98);
    });

    it('never exceeds gross minus fee (no-loss invariant)', () => {
      const gross = 100;
      const fee = 3;
      const buffer = 1.05;
      const sent = CryptoInput.calcReturnSendAmount(gross, 1000, fee, buffer, 12);

      expect(sent).toBeLessThanOrEqual(gross - fee * buffer);
    });

    it('throws when the gross amount is missing', () => {
      expect(() => CryptoInput.calcReturnSendAmount(null, 10, 2, 1.05, 12)).toThrow(
        'Gross amount is required to calculate the return send amount',
      );
    });

    it('throws when the fee is missing', () => {
      expect(() => CryptoInput.calcReturnSendAmount(100, 10, null, 1.05, 12)).toThrow(
        'Fee in input asset is required to calculate the return send amount',
      );
    });
  });

  describe('#effectiveReturnGasCost(...)', () => {
    it('uses the fresh gas cost when it is higher', () => {
      expect(CryptoInput.effectiveReturnGasCost(10, 5, 1.05, 12)).toBe(10.5);
    });

    it('uses the estimated gas cost when it is higher', () => {
      expect(CryptoInput.effectiveReturnGasCost(5, 10, 1.05, 12)).toBe(10.5);
    });

    it('is stable when fresh and estimated are equal', () => {
      expect(CryptoInput.effectiveReturnGasCost(10, 10, 1.05, 12)).toBe(10.5);
    });

    it('applies no premium when the buffer is 1', () => {
      expect(CryptoInput.effectiveReturnGasCost(10, 5, 1, 12)).toBe(10);
    });

    it('rounds the result to the given decimals', () => {
      // max(1/3, 0) * 1 = 0.3333...; rounded to 4 decimals = 0.3333
      expect(CryptoInput.effectiveReturnGasCost(1 / 3, 0, 1, 4)).toBe(0.3333);
    });
  });

  describe('#distributeReturnAmount(...)', () => {
    it('assigns the full total to a single pay-in', () => {
      expect(CryptoInput.distributeReturnAmount(50, [30], 12)).toEqual([50]);
    });

    it('distributes proportionally to the authorized share', () => {
      expect(CryptoInput.distributeReturnAmount(90, [10, 20], 12)).toEqual([30, 60]);
    });

    it('splits an even total evenly', () => {
      expect(CryptoInput.distributeReturnAmount(98, [50, 50], 12)).toEqual([49, 49]);
    });

    it('returns all zeros when the total authorized amount is zero', () => {
      expect(CryptoInput.distributeReturnAmount(10, [0, 0], 12)).toEqual([0, 0]);
    });

    it('puts the rounding remainder on the largest share and keeps the sum exact', () => {
      const result = CryptoInput.distributeReturnAmount(1, [1, 1, 1], 12);

      expect(Util.round(Util.sum(result), 12)).toBe(1);
      // remainder lands on the first (largest) share
      expect(result[0]).toBeGreaterThanOrEqual(result[1]);
    });

    it('keeps sum(result) === total across uneven distributions', () => {
      const cases: { total: number; authorized: number[] }[] = [
        { total: 100, authorized: [33, 33, 34] },
        { total: 7.77, authorized: [1, 2, 3] },
        { total: 10, authorized: [1, 1, 1] },
      ];

      for (const { total, authorized } of cases) {
        const result = CryptoInput.distributeReturnAmount(total, authorized, 12);
        expect(Util.round(Util.sum(result), 12)).toBe(total);
      }
    });

    it('places the remainder on the largest share (index 1), not the first share', () => {
      // proportional shares round to [1, 3, 2] (sum 6) but total is 5 → remainder -1 must land on the largest (index 1)
      const result = CryptoInput.distributeReturnAmount(5, [1, 3, 2], 0);

      expect(result).toEqual([1, 2, 2]);
      expect(result[0]).toBe(1); // first share stays at its proportional value
      expect(Util.sum(result)).toBe(5);
    });

    it('keeps the sum exact when the rounding remainder is negative', () => {
      // proportional shares round to [1, 1, 1] (sum 3) but total is 2 → remainder -1
      const result = CryptoInput.distributeReturnAmount(2, [1, 1, 1], 0);

      expect(result).toEqual([0, 1, 1]);
      expect(Util.sum(result)).toBe(2);
    });
  });

  describe('#isReturnEconomic(...)', () => {
    it('is economic for a positive amount', () => {
      expect(CryptoInput.isReturnEconomic(5)).toBe(true);
    });

    it('is not economic for zero', () => {
      expect(CryptoInput.isReturnEconomic(0)).toBe(false);
    });

    it('is not economic for a negative amount', () => {
      expect(CryptoInput.isReturnEconomic(-1)).toBe(false);
    });
  });

  describe('#return(...)', () => {
    it('sets tx id, status, fee and returned amount', () => {
      const entity = Object.assign(new CryptoInput(), { action: PayInAction.RETURN });

      entity.return('RETURN_TX', 0.5, 98.5);

      expect(entity.returnTxId).toBe('RETURN_TX');
      expect(entity.status).toBe(PayInStatus.RETURNED);
      expect(entity.forwardFeeAmount).toBe(0.5);
      expect(entity.returnAmount).toBe(98.5);
    });

    it('does not overwrite fee or returned amount when they are not provided', () => {
      const entity = Object.assign(new CryptoInput(), {
        action: PayInAction.RETURN,
        forwardFeeAmount: 1,
        returnAmount: 42,
      });

      entity.return('RETURN_TX');

      expect(entity.returnTxId).toBe('RETURN_TX');
      expect(entity.status).toBe(PayInStatus.RETURNED);
      expect(entity.forwardFeeAmount).toBe(1);
      expect(entity.returnAmount).toBe(42);
    });
  });

  describe('#sendingAmount', () => {
    it('returns the return amount for a return when set', () => {
      const entity = Object.assign(new CryptoInput(), {
        action: PayInAction.RETURN,
        amount: 100,
        chargebackAmount: 99,
        returnAmount: 97.9,
      });

      expect(entity.sendingAmount).toBe(97.9);
    });

    it('falls back to the chargeback amount for a return without a return amount', () => {
      const entity = Object.assign(new CryptoInput(), {
        action: PayInAction.RETURN,
        amount: 100,
        chargebackAmount: 99,
      });

      expect(entity.sendingAmount).toBe(99);
    });

    it('returns the full amount for a forward regardless of the return amount', () => {
      const entity = Object.assign(new CryptoInput(), {
        action: PayInAction.FORWARD,
        amount: 100,
        chargebackAmount: 99,
        returnAmount: 97.9,
      });

      expect(entity.sendingAmount).toBe(100);
    });
  });
});
