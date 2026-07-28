import { LiquidityManagementOrderStatus } from '../../enums';
import { LiquidityManagementOrder } from '../liquidity-management-order.entity';

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60 * 1000);

describe('LiquidityManagementOrder', () => {
  describe('releaseWaitedOutVenue', () => {
    function released(at?: Date): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        notSentRecheckDue: at,
      });
    }

    it('is false while no release is pending at all', () => {
      expect(released(undefined).releaseWaitedOutVenue()).toBe(false);
      expect(released(null).releaseWaitedOutVenue()).toBe(false);
    });

    it('is false just inside the wait', () => {
      expect(released(minutesAgo(59)).releaseWaitedOutVenue()).toBe(false);
    });

    it('is true once the wait has been exceeded', () => {
      expect(released(minutesAgo(61)).releaseWaitedOutVenue()).toBe(true);
    });
  });

  describe('resolveAsSent / resolveAsNotSent / requestNotSentRelease', () => {
    it('accepts a release without acting on it: the order keeps blocking', () => {
      const order = Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
      }).requestNotSentRelease('checked by hand');

      expect(order.status).toBe(LiquidityManagementOrderStatus.UNCERTAIN);
      expect(order.notSentRecheckDue).toBeInstanceOf(Date);
    });

    it('drops the pending release when the order turns out to have been sent', () => {
      const order = Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        notSentRecheckDue: minutesAgo(5),
      }).resolveAsSent();

      expect(order.status).toBe(LiquidityManagementOrderStatus.IN_PROGRESS);
      expect(order.notSentRecheckDue).toBeNull();
    });

    it('drops it when the release is put into effect, so nothing is owed afterwards', () => {
      const order = Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        notSentRecheckDue: minutesAgo(5),
      }).resolveAsNotSent('released');

      expect(order.status).toBe(LiquidityManagementOrderStatus.FAILED);
      expect(order.notSentRecheckDue).toBeNull();
    });
  });
});
