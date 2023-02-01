import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { createDefaultPayoutOrder, createCustomPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { PayoutUtils } from '../payout-utils';

describe('PayoutUtils', () => {
  describe('#groupOrdersByContext(...)', () => {
    it('returns an instance of Map', () => {
      expect(PayoutUtils.groupOrdersByContext([])).toBeInstanceOf(Map);
      expect(PayoutUtils.groupOrdersByContext([createDefaultPayoutOrder()])).toBeInstanceOf(Map);
    });

    it('separates orders in different groups by context', () => {
      const orders = [
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.STAKING_REWARD }),
      ];

      const groups = PayoutUtils.groupOrdersByContext(orders);

      expect([...groups.entries()].length).toBe(2);
      expect([...groups.keys()][0]).toBe(PayoutOrderContext.BUY_CRYPTO);
      expect([...groups.keys()][1]).toBe(PayoutOrderContext.STAKING_REWARD);
      expect([...groups.values()][0].length).toBe(2);
      expect([...groups.values()][1].length).toBe(1);
    });

    it('puts orders with same context in one group', () => {
      const orders = [
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
        createCustomPayoutOrder({ context: PayoutOrderContext.BUY_CRYPTO }),
      ];

      const groups = PayoutUtils.groupOrdersByContext(orders);

      expect([...groups.entries()].length).toBe(1);
      expect([...groups.keys()][0]).toBe(PayoutOrderContext.BUY_CRYPTO);
      expect([...groups.values()][0].length).toBe(3);
    });
  });
});
