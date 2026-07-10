import { RateLimitGuard } from '../rate-limit.guard';

describe('RateLimitGuard', () => {
  const guard = new RateLimitGuard({} as any, {} as any, {} as any);

  const getTracker = (realIp: string): string => guard['getTracker']({ realIp });

  describe('IPv4', () => {
    it('groups by /24', () => {
      expect(getTracker('185.12.34.56')).toEqual('185.12.34');
      expect(getTracker('185.12.34.99')).toEqual('185.12.34');
    });

    it('separates different /24 networks', () => {
      expect(getTracker('185.12.34.56')).not.toEqual(getTracker('185.12.35.56'));
    });

    it('groups IPv4-mapped IPv6 by embedded /24', () => {
      expect(getTracker('::ffff:185.12.34.56')).toEqual('::ffff:185.12.34');
    });
  });

  describe('IPv6', () => {
    it('groups by /64 prefix', () => {
      expect(getTracker('2001:db8:85a3:1:0:8a2e:370:7334')).toEqual('2001:db8:85a3:1');
      expect(getTracker('2001:db8:85a3:1:ffff:ffff:ffff:ffff')).toEqual('2001:db8:85a3:1');
    });

    it('expands :: compression before taking the prefix', () => {
      expect(getTracker('2001:db8::1234')).toEqual('2001:db8:0:0');
      expect(getTracker('::1')).toEqual('0:0:0:0');
    });

    it('normalizes case and leading zeros', () => {
      expect(getTracker('2001:0DB8:85A3:0001::1')).toEqual('2001:db8:85a3:1');
    });

    it('separates different /64 networks', () => {
      expect(getTracker('2001:db8:85a3:1::1')).not.toEqual(getTracker('2001:db8:85a3:2::1'));
    });

    it('never returns an empty tracker', () => {
      expect(getTracker('2001:db8::1234')).not.toEqual('');
    });
  });

  describe('non-IP fallbacks', () => {
    it('keeps the socket fallback value as its own bucket', () => {
      expect(getTracker('unknown')).toEqual('unknown');
    });
  });
});
