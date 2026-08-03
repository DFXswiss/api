import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums';
import { AuthGuard } from '@nestjs/passport';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PartnerStatisticRateLimitGuard } from '../partner-statistic-rate-limit.guard';
import { PartnerStatisticController } from '../partner-statistic.controller';
import { PartnerStatisticGranularity } from '../partner-statistic.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

/**
 * Pins the partner-statistic controller wiring: guard order, throttle budget,
 * role-aware wallet resolution, and the Day granularity default on the timeline route.
 * Pattern mirrors ledger.controller + bank.controller metadata specs.
 */
describe('PartnerStatisticController', () => {
  let controller: PartnerStatisticController;
  let service: DeepMocked<PartnerStatisticService>;

  const companyJwt = { user: 42, role: UserRole.CLIENT_COMPANY, account: 7 } as JwtPayload;

  beforeEach(() => {
    service = createMock<PartnerStatisticService>();
    // Default: resolve mirrors CLIENT_COMPANY (jwt.user is wallet id) unless a test overrides.
    service.resolveWalletId.mockImplementation(async (jwt) => jwt.user as number);
    controller = new PartnerStatisticController(service);
  });

  it('CLIENT_COMPANY: resolves wallet from jwt and forwards to getStatistics (not account)', async () => {
    service.getStatistics.mockResolvedValue({ currency: 'CHF' } as any);
    service.resolveWalletId.mockResolvedValue(42);

    await controller.getPartnerStatistics(companyJwt, '2024-06-01', '2024-06-15');

    expect(service.resolveWalletId).toHaveBeenCalledWith(companyJwt);
    expect(service.getStatistics).toHaveBeenCalledWith(42, '2024-06-01', '2024-06-15');
    expect(service.getStatistics).not.toHaveBeenCalledWith(7, expect.anything(), expect.anything());
  });

  it('CLIENT_COMPANY: forwards resolved wallet and optional granularity to getTimeline', async () => {
    service.getTimeline.mockResolvedValue({ currency: 'CHF', granularity: PartnerStatisticGranularity.WEEK } as any);
    service.resolveWalletId.mockResolvedValue(42);

    await controller.getPartnerTimeline(companyJwt, '2024-06-01', '2024-06-15', PartnerStatisticGranularity.WEEK);

    expect(service.resolveWalletId).toHaveBeenCalledWith(companyJwt);
    expect(service.getTimeline).toHaveBeenCalledWith(42, '2024-06-01', '2024-06-15', PartnerStatisticGranularity.WEEK);
  });

  it('forwards undefined granularity to getTimeline when the query omits it', async () => {
    service.getTimeline.mockResolvedValue({ currency: 'CHF', granularity: PartnerStatisticGranularity.DAY } as any);
    service.resolveWalletId.mockResolvedValue(42);

    await controller.getPartnerTimeline(companyJwt, undefined, undefined, undefined);

    expect(service.getTimeline).toHaveBeenCalledWith(42, undefined, undefined, undefined);
  });

  /**
   * Tenant isolation (the real failure mode): a NON_CUSTODIAL_WALLET_PARTNER user whose user id equals a *foreign*
   * wallet id must still only see their own wallet — never treat jwt.user as walletId.
   */
  it('NON_CUSTODIAL_WALLET_PARTNER: never uses jwt.user as walletId even when user id equals a foreign wallet id', async () => {
    const foreignWalletId = 99;
    const ownWalletId = 7;
    // jwt.user === foreignWalletId is exactly the cross-tenant trap if resolution is skipped.
    const partnerJwt = {
      user: foreignWalletId,
      role: UserRole.NON_CUSTODIAL_WALLET_PARTNER,
      account: 1,
    } as JwtPayload;

    service.resolveWalletId.mockResolvedValue(ownWalletId);
    service.getStatistics.mockResolvedValue({ currency: 'CHF' } as any);
    service.getTimeline.mockResolvedValue({ currency: 'CHF', granularity: PartnerStatisticGranularity.DAY } as any);

    await controller.getPartnerStatistics(partnerJwt, '2024-06-01', '2024-06-15');
    await controller.getPartnerTimeline(partnerJwt, '2024-06-01', '2024-06-15', PartnerStatisticGranularity.DAY);

    expect(service.resolveWalletId).toHaveBeenCalledWith(partnerJwt);
    expect(service.getStatistics).toHaveBeenCalledWith(ownWalletId, '2024-06-01', '2024-06-15');
    expect(service.getStatistics).not.toHaveBeenCalledWith(foreignWalletId, expect.anything(), expect.anything());
    expect(service.getTimeline).toHaveBeenCalledWith(
      ownWalletId,
      '2024-06-01',
      '2024-06-15',
      PartnerStatisticGranularity.DAY,
    );
    expect(service.getTimeline).not.toHaveBeenCalledWith(
      foreignWalletId,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('rejects when resolveWalletId rejects (e.g. user has no wallet)', async () => {
    service.resolveWalletId.mockRejectedValue(new ForbiddenException('User has no wallet'));

    await expect(controller.getPartnerStatistics(companyJwt, undefined, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.getStatistics).not.toHaveBeenCalled();
  });
});

// Call-path tests above pass JWT in directly and cannot see the decorators that decide
// whether a request is authenticated, role-checked, or rate-limited. Removing @UseGuards
// or swapping RoleGuard for a weaker role would leave them green while every non-partner
// wallet reached the service.
describe('PartnerStatisticController routing & security metadata', () => {
  const endpoints: Array<{
    handler: 'getPartnerStatistics' | 'getPartnerTimeline';
    path: string;
  }> = [
    { handler: 'getPartnerStatistics', path: 'partner' },
    { handler: 'getPartnerTimeline', path: 'partner/timeline' },
  ];

  it('is mounted under the statistic base path', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PartnerStatisticController)).toBe('statistic');
  });

  it.each(endpoints)('maps $handler to GET $path', ({ handler, path }) => {
    const fn = PartnerStatisticController.prototype[handler];
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET);
  });

  it.each(endpoints)(
    'guards $handler with AuthGuard → RoleGuard(CLIENT_COMPANY|NON_CUSTODIAL_WALLET_PARTNER) → PartnerStatisticRateLimitGuard',
    ({ handler }) => {
      const fn = PartnerStatisticController.prototype[handler];
      const guards = Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[];

      expect(guards).toHaveLength(3);

      // Order matters: auth first, then role, then the partner-specific rate limit.
      // AuthGuard() is memoized — same class reference as the decorator on the route
      // (bank.controller pattern: exact class-token equality, not constructor.name).
      expect(guards[0]).toBe(AuthGuard());

      // RoleGuard is the only instance-based guard; it must admit CLIENT_COMPANY or NON_CUSTODIAL_WALLET_PARTNER.
      const roleGuard = guards.find((g) => (g as { entryRoles?: UserRole[] }).entryRoles !== undefined) as {
        entryRoles: UserRole[];
      };
      expect(roleGuard).toBeDefined();
      expect(roleGuard.entryRoles).toEqual([UserRole.CLIENT_COMPANY, UserRole.NON_CUSTODIAL_WALLET_PARTNER]);
      expect((roleGuard as { constructor: { name: string } }).constructor.name).toBe('RoleGuardClass');

      expect(guards[1]).toBe(roleGuard);
      expect(guards[2]).toBe(PartnerStatisticRateLimitGuard);
    },
  );

  it.each(endpoints)('throttles $handler at 120 req / 3600 s', ({ handler }) => {
    const fn = PartnerStatisticController.prototype[handler];
    // Without this decorator the RateLimitGuard has no per-route budget (ThrottlerModule.forRoot
    // is registered without options in this app for some routes).
    expect(Reflect.getMetadata(THROTTLER_LIMIT, fn)).toBe(120);
    expect(Reflect.getMetadata(THROTTLER_TTL, fn)).toBe(3600);
  });

  it('RoleGuard admits CLIENT_COMPANY and NON_CUSTODIAL_WALLET_PARTNER, rejects plain USER', () => {
    // Metadata alone does not execute RoleGuard; pin the OR semantics the decorator encodes.
    const guard = RoleGuard(UserRole.CLIENT_COMPANY, UserRole.NON_CUSTODIAL_WALLET_PARTNER);
    const contextFor = (role: UserRole) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user: { role, account: 1 } }) }),
      }) as any;

    expect(guard.canActivate(contextFor(UserRole.CLIENT_COMPANY))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.NON_CUSTODIAL_WALLET_PARTNER))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.KYC_CLIENT_COMPANY))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.USER))).toBe(false);
    expect(guard.canActivate(contextFor(UserRole.SUPPORT))).toBe(false);
  });
});
