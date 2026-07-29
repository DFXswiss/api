import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import * as processServiceModule from 'src/shared/services/process.service';
import { DbQueryDto } from 'src/subdomains/generic/gs/dto/db-query.dto';
import { GsTriggerType } from 'src/subdomains/generic/gs/dto/gs-trigger-type.enum';
import { GsController } from 'src/subdomains/generic/gs/gs.controller';
import { GsService } from 'src/subdomains/generic/gs/gs.service';

// Unit-level regression coverage for `GsController`'s private `logAndCheckTrigger` helper
// (called from both `getDbData` and `getExtendedData`), exercised against the REAL controller —
// unlike `gs.controller.e2e.spec.ts`, which cannot bootstrap the real `GsController` through
// NestJS' HTTP pipeline: `RoleGuard()` / `UserActiveGuard()` bake already-instantiated guard
// objects into `@UseGuards()` at controller-decoration time, so a fresh `Test.overrideGuard()`
// call from a test module can't target them. Guards are a framework layer wrapped around the
// controller, not part of the method itself, so a direct `new GsController(service)` plus
// a plain method call sidesteps that problem entirely and exercises the actual production code
// path this feature touches.
describe('GsController', () => {
  let service: DeepMocked<GsService>;
  let controller: GsController;
  let verboseSpy: jest.SpyInstance;

  const jwt: JwtPayload = { role: UserRole.ADMIN, ip: '1.2.3.4' };

  // Both handlers check `Process.GS_DB` before trigger enforcement. `Process.GS_DB` must stay
  // enabled (DisabledProcess -> false) here so the pre-existing endpoint-disabled guard never
  // fires and the trigger check is what's actually under test.

  function query(overrides: Partial<DbQueryDto>): DbQueryDto {
    return Object.assign(new DbQueryDto(), { table: 'asset' }, overrides);
  }

  beforeEach(() => {
    service = createMock<GsService>();
    controller = new GsController(service);
    verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const handlers = [
    { name: 'getDbData', call: (q: DbQueryDto) => controller.getDbData(jwt, q), serviceCall: () => service.getDbData },
    {
      name: 'getExtendedData',
      call: (q: DbQueryDto) => controller.getExtendedData(jwt, q),
      serviceCall: () => service.getExtendedDbData,
    },
  ];

  for (const { name, call, serviceCall } of handlers) {
    describe(name, () => {
      it('rejects a request without trigger, logs first, and never calls the GS service', async () => {
        const started = performance.now();
        let caught: unknown;
        try {
          await call(query({}));
        } catch (e) {
          caught = e;
        }
        const elapsed = performance.now() - started;

        expect(caught).toBeInstanceOf(BadRequestException);
        expect((caught as BadRequestException).message).toBe('Trigger type is required');
        // Structural invariant: audit line is emitted before rejection, service is never entered.
        expect(verboseSpy).toHaveBeenCalledTimes(1);
        expect(verboseSpy).toHaveBeenCalledWith(
          'GS db call: table=asset, identifier=missing, trigger=missing, role=Admin',
        );
        expect(serviceCall()).not.toHaveBeenCalled();
        // Rejection path is synchronous (no SettingService/DB await). Keep a modest SLA so
        // a regression that re-introduces awaited work fails the suite without relying on load.
        expect(elapsed).toBeLessThan(1000);
      });

      it('accepts trigger=Manual', async () => {
        await call(query({ trigger: GsTriggerType.MANUAL }));

        expect(serviceCall()).toHaveBeenCalled();
      });

      it('accepts trigger=Auto', async () => {
        await call(query({ trigger: GsTriggerType.AUTO }));

        expect(serviceCall()).toHaveBeenCalled();
      });
    });
  }

  describe('getDbData log sanitization', () => {
    it('replaces control characters in identifier so log lines cannot be forged', async () => {
      await controller.getDbData(jwt, query({ identifier: 'x\nforged', trigger: GsTriggerType.MANUAL }));

      expect(verboseSpy).toHaveBeenCalledWith(
        'GS db call: table=asset, identifier=x?forged, trigger=Manual, role=Admin',
      );
    });

    it('truncates oversized identifier values and appends a truncation marker', async () => {
      await controller.getDbData(jwt, query({ identifier: 'a'.repeat(500), trigger: GsTriggerType.MANUAL }));

      const logged = verboseSpy.mock.calls[0][0] as string;
      const match = /identifier=([^,]+)/.exec(logged);
      expect(match).not.toBeNull();
      const identifierPart = match![1];
      expect(identifierPart.length).toBeLessThanOrEqual(64 + 3);
      expect(identifierPart.endsWith('...')).toBe(true);
      expect(identifierPart.startsWith('a'.repeat(64))).toBe(true);
    });

    it('sanitizes identifier in the getDbData failure log so log lines cannot be forged', async () => {
      service.getDbData.mockRejectedValue(new Error('boom'));

      let caught: unknown;
      try {
        await controller.getDbData(jwt, query({ identifier: 'x\nforged', trigger: GsTriggerType.MANUAL }));
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).message).toBe('boom');
      expect(verboseSpy.mock.calls[1][0]).toBe('DB data call for asset in x?forged failed:');
    });
  });
});
