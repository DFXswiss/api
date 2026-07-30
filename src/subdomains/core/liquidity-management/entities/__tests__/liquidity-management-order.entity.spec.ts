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

  describe('msUntilAbandonable', () => {
    function quarantined(minutes?: number, command = 'sell', system = 'Scrypt'): LiquidityManagementOrder {
      return Object.assign(new LiquidityManagementOrder(), {
        status: LiquidityManagementOrderStatus.UNCERTAIN,
        updated: minutes == null ? undefined : minutesAgo(minutes),
        action: { system, command },
      });
    }

    it('is Infinity without a timestamp — no deadline to respect constrains nobody', () => {
      expect(quarantined(undefined).msUntilAbandonable()).toBe(Infinity);
    });

    it('counts down the trade bound', () => {
      // 2 of the 5 minutes spent, so 3 left; tolerance covers the clock moving during the test
      expect(quarantined(2).msUntilAbandonable()).toBeGreaterThan(2.9 * 60_000);
      expect(quarantined(2).msUntilAbandonable()).toBeLessThanOrEqual(3 * 60_000);
    });

    it('is zero once the bound has passed, never negative', () => {
      expect(quarantined(6).msUntilAbandonable()).toBe(0);
      expect(quarantined(60 * 24).msUntilAbandonable()).toBe(0);
    });

    it('counts down the long bound for a transfer', () => {
      // an hour into a twelve-hour bound leaves eleven
      expect(quarantined(60, 'withdraw').msUntilAbandonable()).toBeGreaterThan(10.9 * 60 * 60_000);
      expect(quarantined(60, 'withdraw').msUntilAbandonable()).toBeLessThanOrEqual(11 * 60 * 60_000);
    });

    it('never reports time left on an order that is already abandonable', () => {
      // The invariant that carries the safety, in the direction that carries it: an order past its bound must
      // report nothing left, or a caller throttling itself by this value would wait beyond the very ceiling
      // the bound imposes. The converse is deliberately not asserted — at the single instant where elapsed
      // equals the bound the remaining time is already zero while the bound is not yet exceeded, and a
      // non-negative duration cannot express that difference. It costs one cooldown floor, never a missed
      // abandonment.
      for (const minutes of [1, 4, 6, 30, 11 * 60, 13 * 60, 60 * 24])
        for (const command of ['sell', 'buy', 'withdraw']) {
          const order = quarantined(minutes, command);
          if (order.unresolvableTooLong()) expect(order.msUntilAbandonable()).toBe(0);
        }
    });

    it('applies the same bound to the same action as unresolvableTooLong', () => {
      // Both read one shared source, so a trade and a transfer must disagree here exactly where they
      // disagree there: at 30 minutes the trade bound is long spent while the transfer bound is not.
      expect(quarantined(30, 'sell').msUntilAbandonable()).toBe(0);
      expect(quarantined(30, 'sell').unresolvableTooLong()).toBe(true);
      expect(quarantined(30, 'withdraw').msUntilAbandonable()).toBeGreaterThan(0);
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
