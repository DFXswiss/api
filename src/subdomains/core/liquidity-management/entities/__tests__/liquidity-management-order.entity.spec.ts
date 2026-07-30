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

  describe('abandonableAt', () => {
    function quarantined(minutes?: number, command = 'sell', system = 'Scrypt'): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        updated: minutes == null ? undefined : minutesAgo(minutes),
        action: { system, command },
      });
    }

    /** Milliseconds from now until the order may be given up; negative once it already may be. */
    function headroom(order: LiquidityManagementOrder): number {
      const at = order.getAbandonableAt();
      if (!at) throw new Error('expected a deadline');

      return at.getTime() - Date.now();
    }

    it('is null without a timestamp — no deadline to respect constrains nobody', () => {
      expect(quarantined(undefined).getAbandonableAt()).toBeNull();
    });

    it('falls the trade bound after the moment quarantine began', () => {
      // 2 of the 5 minutes spent, so 3 left; tolerance covers the clock moving during the test
      expect(headroom(quarantined(2))).toBeGreaterThan(2.9 * 60_000);
      expect(headroom(quarantined(2))).toBeLessThanOrEqual(3 * 60_000);
    });

    it('lies in the past once the bound has passed, and says by how much', () => {
      // The sign is the point: a duration clamped at zero cannot say whether a wait started before the
      // deadline, which is exactly what a throttle has to know after it.
      expect(headroom(quarantined(6))).toBeLessThan(0);
      expect(headroom(quarantined(6))).toBeGreaterThan(-1.1 * 60_000);
      expect(headroom(quarantined(60 * 24))).toBeLessThan(-23 * 60 * 60_000);
    });

    it('falls the long bound for a transfer', () => {
      // an hour into a twelve-hour bound leaves eleven
      expect(headroom(quarantined(60, 'withdraw'))).toBeGreaterThan(10.9 * 60 * 60_000);
      expect(headroom(quarantined(60, 'withdraw'))).toBeLessThanOrEqual(11 * 60 * 60_000);
    });

    it('turns over at the bound itself, not a tick later', () => {
      // The one instant a live clock cannot be asked about: elapsed exactly equal to the bound. Anything built
      // from a real `Date.now()` is already a fraction past it, where `>` and `>=` agree — so the clock is held
      // still. With `>` the pass would run (the deadline has arrived) and abandon nothing (not yet past it),
      // re-stamp its cooldown, and the order would wait out another interval: five minutes became six.
      jest.useFakeTimers();
      try {
        const order = quarantined(5);
        expect(headroom(order)).toBe(0);
        expect(order.unresolvableTooLong()).toBe(true);

        // and one millisecond short of it, both still say no
        const justInside = Object.assign(new LiquidityManagementOrder(), {
          status: LiquidityManagementOrderStatus.UNCERTAIN,
          updated: new Date(Date.now() - (5 * 60_000 - 1)),
          action: { system: 'Scrypt', command: 'sell' },
        });
        expect(headroom(justInside)).toBe(1);
        expect(justInside.unresolvableTooLong()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('has passed exactly when the order has become abandonable', () => {
      // The two halves of one clock, and they must agree in both directions. The deadline having arrived is what
      // lets the reconciliation pass run at all, and being past the bound is what lets it give the order up: a
      // state where one holds and the other does not is a pass that runs, re-stamps its cooldown and abandons
      // nothing — which is how a five-minute bound came to give up at six.
      for (const minutes of [1, 4, 5, 6, 30, 11 * 60, 12 * 60, 13 * 60, 60 * 24])
        for (const command of ['sell', 'buy', 'withdraw']) {
          const order = quarantined(minutes, command);
          expect(headroom(order) <= 0).toBe(order.unresolvableTooLong());
        }
    });

    it('applies the same bound to the same action as unresolvableTooLong', () => {
      // Both read one shared source, so a trade and a transfer must disagree here exactly where they disagree
      // there: at 30 minutes the trade bound is long spent while the transfer bound is not.
      expect(headroom(quarantined(30, 'sell'))).toBeLessThan(0);
      expect(quarantined(30, 'sell').unresolvableTooLong()).toBe(true);
      expect(headroom(quarantined(30, 'withdraw'))).toBeGreaterThan(0);
      expect(quarantined(30, 'withdraw').unresolvableTooLong()).toBe(false);
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
