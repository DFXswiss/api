import { PartnerStatisticRateLimitGuard } from '../partner-statistic-rate-limit.guard';

describe('PartnerStatisticRateLimitGuard', () => {
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

  it('falls back to IP when jwt.user is missing', () => {
    expect(getTracker({ realIp: '9.9.9.9' })).toBe('partner-stat:ip:9.9.9.9');
  });
});
