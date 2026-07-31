import { InternalServerErrorException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Config, ConfigService } from 'src/config/config';
import { PartnerStatisticRateLimitGuard } from '../partner-statistic-rate-limit.guard';

describe('PartnerStatisticRateLimitGuard', () => {
  beforeAll(() => new ConfigService());

  const guard = new PartnerStatisticRateLimitGuard({} as any, {} as any, {} as any);

  const getTracker = (req: Record<string, unknown>): string => guard['getTracker'](req);

  it('keys by jwt.user (wallet id) when present', () => {
    expect(getTracker({ user: { user: 42 }, realIp: '1.2.3.4' })).toBe('partner-stat:wallet:42');
    expect(getTracker({ user: { user: 99 }, realIp: '1.2.3.4' })).toBe('partner-stat:wallet:99');
    expect(getTracker({ user: { user: 42 }, realIp: '1.2.3.4' })).not.toBe(
      getTracker({ user: { user: 99 }, realIp: '1.2.3.4' }),
    );
  });

  it('does not share a bucket across wallets on the same IP', () => {
    const a = getTracker({ user: { user: 1 }, realIp: '185.12.34.56' });
    const b = getTracker({ user: { user: 2 }, realIp: '185.12.34.56' });
    expect(a).not.toEqual(b);
  });

  it('throws InternalServerError when jwt.user is missing (fail-closed, no IP fallback)', () => {
    expect(() => getTracker({ realIp: '9.9.9.9' })).toThrow(InternalServerErrorException);
    expect(() => getTracker({ realIp: '9.9.9.9' })).toThrow(/authenticated wallet/);
    expect(() => getTracker({})).toThrow(InternalServerErrorException);
  });

  describe('handleRequest', () => {
    it('skips throttling when Config.request.limitCheck is false', async () => {
      const prev = Config.request.limitCheck;
      Config.request.limitCheck = false;
      try {
        const result = await guard.handleRequest({} as any, 120, 3600);
        expect(result).toBe(true);
      } finally {
        Config.request.limitCheck = prev;
      }
    });

    it('delegates to ThrottlerGuard when limitCheck is true', async () => {
      const prev = Config.request.limitCheck;
      Config.request.limitCheck = true;
      // handleRequest is protected on ThrottlerGuard — cast for the spy.
      const superSpy = jest
        .spyOn(ThrottlerGuard.prototype as unknown as { handleRequest: typeof guard.handleRequest }, 'handleRequest')
        .mockResolvedValue(true);
      try {
        const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }) } as any;
        const result = await guard.handleRequest(ctx, 120, 3600);
        expect(superSpy).toHaveBeenCalledWith(ctx, 120, 3600);
        expect(result).toBe(true);
      } finally {
        Config.request.limitCheck = prev;
        superSpy.mockRestore();
      }
    });
  });
});
