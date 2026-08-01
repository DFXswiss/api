import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PartnerStatisticRateLimitGuard } from '../partner-statistic-rate-limit.guard';
import { PartnerStatisticController } from '../partner-statistic.controller';
import { PartnerStatisticGranularity } from '../partner-statistic.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

/**
 * Pins the partner-statistic controller wiring: guard order, throttle budget,
 * walletId from jwt.user, and the Day granularity default on the timeline route.
 * Pattern mirrors ledger.controller + bank.controller metadata specs.
 */
describe('PartnerStatisticController', () => {
  let controller: PartnerStatisticController;
  let service: DeepMocked<PartnerStatisticService>;

  const jwt = { user: 42, role: UserRole.CLIENT_COMPANY, account: 7 } as JwtPayload;

  beforeEach(() => {
    service = createMock<PartnerStatisticService>();
    controller = new PartnerStatisticController(service);
  });

  it('forwards jwt.user as walletId to getStatistics (not account)', async () => {
    service.getStatistics.mockResolvedValue({ currency: 'CHF' } as any);

    await controller.getPartnerStatistics(jwt, '2024-06-01', '2024-06-15');

    expect(service.getStatistics).toHaveBeenCalledWith(42, '2024-06-01', '2024-06-15');
    expect(service.getStatistics).not.toHaveBeenCalledWith(7, expect.anything(), expect.anything());
  });

  it('forwards jwt.user and optional granularity to getTimeline', async () => {
    service.getTimeline.mockResolvedValue({ currency: 'CHF', granularity: PartnerStatisticGranularity.WEEK } as any);

    await controller.getPartnerTimeline(jwt, '2024-06-01', '2024-06-15', PartnerStatisticGranularity.WEEK);

    expect(service.getTimeline).toHaveBeenCalledWith(42, '2024-06-01', '2024-06-15', PartnerStatisticGranularity.WEEK);
  });

  it('omits granularity so the service Day default applies', async () => {
    service.getTimeline.mockResolvedValue({ currency: 'CHF', granularity: PartnerStatisticGranularity.DAY } as any);

    await controller.getPartnerTimeline(jwt, undefined, undefined, undefined);

    expect(service.getTimeline).toHaveBeenCalledWith(42, undefined, undefined, undefined);
  });
});

// Call-path tests above pass JWT in directly and cannot see the decorators that decide
// whether a request is authenticated, role-checked, or rate-limited. Removing @UseGuards
// or swapping RoleGuard(CLIENT_COMPANY) for a weaker role would leave them green while
// every non-partner wallet reached the service.
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
    'guards $handler with AuthGuard → RoleGuard(CLIENT_COMPANY) → PartnerStatisticRateLimitGuard',
    ({ handler }) => {
      const fn = PartnerStatisticController.prototype[handler];
      const guards = Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[];

      expect(guards).toHaveLength(3);

      // Order matters: auth first, then role, then the partner-specific rate limit.
      // RoleGuard is the only instance-based guard; it must carry CLIENT_COMPANY.
      // Order: AuthGuard() mixin class, RoleGuard instance, rate-limit class token.
      // RoleGuard is the only instance-based guard; it must carry CLIENT_COMPANY.
      const roleGuard = guards.find((g) => (g as { entryRoles?: UserRole[] }).entryRoles !== undefined) as {
        entryRoles: UserRole[];
      };
      expect(roleGuard).toBeDefined();
      expect(roleGuard.entryRoles).toEqual([UserRole.CLIENT_COMPANY]);
      expect((roleGuard as { constructor: { name: string } }).constructor.name).toBe('RoleGuardClass');

      // Auth first (passport mixin class), role second, partner rate-limit third.
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
});
