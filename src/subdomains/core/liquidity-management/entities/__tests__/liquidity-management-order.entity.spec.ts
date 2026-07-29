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

  describe('unresolvableTooLong', () => {
    function quarantined(minutes?: number, command = 'sell', system = 'Scrypt'): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        updated: minutes == null ? undefined : minutesAgo(minutes),
        action: { system, command },
      });
    }

    it('is false without a quarantine timestamp — a missing date reads as the epoch, which would fire at once', () => {
      expect(quarantined(undefined).unresolvableTooLong()).toBe(false);
    });

    it.each(['sell', 'buy'])('applies the short trade bound to scrypt/%s', (command) => {
      expect(quarantined(4, command).unresolvableTooLong()).toBe(false);
      expect(quarantined(6, command).unresolvableTooLong()).toBe(true);
    });

    it('applies the long bound to a transfer at the same venue', () => {
      expect(quarantined(11 * 60, 'withdraw').unresolvableTooLong()).toBe(false);
      expect(quarantined(13 * 60, 'withdraw').unresolvableTooLong()).toBe(true);
    });

    it('applies the long bound to a command that only looks like a trade elsewhere', () => {
      // an on-chain swap is not a book match, whatever it is called
      expect(quarantined(30, 'sell', 'DfxDex').unresolvableTooLong()).toBe(false);
    });

    it('applies the long bound to anything unrecognised', () => {
      expect(quarantined(30, 'some-new-command', 'SomeNewSystem').unresolvableTooLong()).toBe(false);
    });
  });

  describe('unobservedTooLong', () => {
    function quarantined(minutes?: number): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        updated: minutes == null ? undefined : minutesAgo(minutes),
        action: { system: 'Scrypt', command: 'sell' },
      });
    }

    it('is false without a quarantine timestamp', () => {
      expect(quarantined(undefined).unobservedTooLong()).toBe(false);
    });

    it('outlasts every answered bound — silence is weaker ground than an answer', () => {
      // still waiting at an age that would long since have expired had the venue actually replied
      expect(quarantined(13 * 60).unobservedTooLong()).toBe(false);
      expect(quarantined(23 * 60).unobservedTooLong()).toBe(false);
    });

    it('is true once its own clock runs out', () => {
      expect(quarantined(25 * 60).unobservedTooLong()).toBe(true);
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
