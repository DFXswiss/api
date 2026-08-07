import { ThrottlerGuard } from '@nestjs/throttler';
import { Config, ConfigService } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PartnerStatisticRateLimitGuard } from '../partner-statistic-rate-limit.guard';
import { PartnerStatisticService } from '../partner-statistic.service';

describe('PartnerStatisticRateLimitGuard', () => {
  beforeAll(() => new ConfigService());

  const resolveWalletId = jest.fn();
  const partnerStatisticService = { resolveWalletId } as unknown as PartnerStatisticService;
  const guard = new PartnerStatisticRateLimitGuard({} as any, {} as any, {} as any, partnerStatisticService);

  const getTracker = (req: Record<string, unknown>): string => guard['getTracker'](req);

  beforeEach(() => {
    resolveWalletId.mockReset();
  });

  it('keys by resolved partnerStatWalletId when present', () => {
    expect(getTracker({ partnerStatWalletId: 42, realIp: '1.2.3.4' })).toBe('partner-stat:wallet:42');
    expect(getTracker({ partnerStatWalletId: 99, realIp: '1.2.3.4' })).toBe('partner-stat:wallet:99');
    expect(getTracker({ partnerStatWalletId: 42, realIp: '1.2.3.4' })).not.toBe(
      getTracker({ partnerStatWalletId: 99, realIp: '1.2.3.4' }),
    );
  });

  it('does not share a bucket across wallets on the same IP', () => {
    const a = getTracker({ partnerStatWalletId: 1, realIp: '185.12.34.56' });
    const b = getTracker({ partnerStatWalletId: 2, realIp: '185.12.34.56' });
    expect(a).not.toEqual(b);
  });

  it('does not key by jwt.user alone (NON_CUSTODIAL_WALLET_PARTNER user id must not be the tracker)', () => {
    // Without partnerStatWalletId, even if jwt.user is set, fail closed — otherwise two
    // employees of the same wallet would get separate budgets keyed by user id.
    expect(() =>
      getTracker({ user: { user: 42, role: UserRole.NON_CUSTODIAL_WALLET_PARTNER }, realIp: '1.2.3.4' }),
    ).toThrow(/authenticated wallet/);
  });

  it('throws plain Error when partnerStatWalletId is missing (fail-closed, no IP fallback)', () => {
    expect(() => getTracker({ realIp: '9.9.9.9' })).toThrow(Error);
    expect(() => getTracker({ realIp: '9.9.9.9' })).toThrow(/authenticated wallet/);
    expect(() => getTracker({})).toThrow(Error);
    try {
      getTracker({});
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).constructor.name).toBe('Error');
    }
  });

  describe('handleRequest', () => {
    it('skips throttling when Config.request.limitCheck is false', async () => {
      const prev = Config.request.limitCheck;
      Config.request.limitCheck = false;
      try {
        const result = await guard.handleRequest({} as any, 120, 3600);
        expect(result).toBe(true);
        expect(resolveWalletId).not.toHaveBeenCalled();
      } finally {
        Config.request.limitCheck = prev;
      }
    });

    it('resolves wallet id and keys by it when limitCheck is true', async () => {
      const prev = Config.request.limitCheck;
      Config.request.limitCheck = true;
      resolveWalletId.mockResolvedValue(7);
      const req: Record<string, any> = {
        user: { user: 99, role: UserRole.NON_CUSTODIAL_WALLET_PARTNER },
      };
      // handleRequest is protected on ThrottlerGuard — cast for the spy.
      const superSpy = jest
        .spyOn(ThrottlerGuard.prototype as unknown as { handleRequest: typeof guard.handleRequest }, 'handleRequest')
        .mockResolvedValue(true);
      try {
        const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as any;
        const result = await guard.handleRequest(ctx, 120, 3600);
        expect(resolveWalletId).toHaveBeenCalledWith(req.user);
        expect(req.partnerStatWalletId).toBe(7);
        // Two NON_CUSTODIAL_WALLET_PARTNER employees of wallet 7 share the same tracker key.
        expect(getTracker(req)).toBe('partner-stat:wallet:7');
        expect(getTracker(req)).not.toBe('partner-stat:wallet:99');
        expect(superSpy).toHaveBeenCalledWith(ctx, 120, 3600);
        expect(result).toBe(true);
      } finally {
        Config.request.limitCheck = prev;
        superSpy.mockRestore();
      }
    });
  });
});
