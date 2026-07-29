import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
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
// controller, not part of the method itself, so a direct `new GsController(service, settingService)` plus
// a plain method call sidesteps that problem entirely and exercises the actual production code
// path this feature touches.
describe('GsController', () => {
  let service: DeepMocked<GsService>;
  let settingService: DeepMocked<SettingService>;
  let controller: GsController;
  let verboseSpy: jest.SpyInstance;

  const jwt: JwtPayload = { role: UserRole.ADMIN, ip: '1.2.3.4' };

  // Both handlers check `Process.GS_DB` before trigger enforcement. `Process.GS_DB` must stay
  // enabled (DisabledProcess -> false) here so the pre-existing endpoint-disabled guard never
  // fires and the trigger check is what's actually under test. Enforcement itself is gated by
  // `SettingService.getObj('gsTriggerEnforcement', ...)`.
  function mockTriggerEnforcement(enforced: boolean): void {
    settingService.getObj.mockResolvedValue(enforced);
  }

  function query(overrides: Partial<DbQueryDto>): DbQueryDto {
    return Object.assign(new DbQueryDto(), { table: 'asset' }, overrides);
  }

  beforeEach(() => {
    service = createMock<GsService>();
    settingService = createMock<SettingService>();
    controller = new GsController(service, settingService);
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
      it('rejects a request without trigger when the check is enabled, and logs table/identifier/trigger as missing', async () => {
        mockTriggerEnforcement(true);

        let caught: unknown;
        try {
          await call(query({}));
        } catch (e) {
          caught = e;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        expect((caught as BadRequestException).message).toBe('Trigger type is required');
        expect(serviceCall()).not.toHaveBeenCalled();
        expect(verboseSpy).toHaveBeenCalledWith(
          'GS db call: table=asset, identifier=missing, trigger=missing, role=Admin',
        );
        expect(settingService.getObj).toHaveBeenCalledWith('gsTriggerEnforcement', false);
      });

      it('accepts trigger=Manual when the check is enabled', async () => {
        mockTriggerEnforcement(true);

        await call(query({ trigger: GsTriggerType.MANUAL }));

        expect(serviceCall()).toHaveBeenCalled();
      });

      it('accepts trigger=Auto when the check is enabled', async () => {
        mockTriggerEnforcement(true);

        await call(query({ trigger: GsTriggerType.AUTO }));

        expect(serviceCall()).toHaveBeenCalled();
      });

      it('accepts a request without trigger when the check is disabled', async () => {
        mockTriggerEnforcement(false);

        await call(query({}));

        expect(serviceCall()).toHaveBeenCalled();
      });
    });
  }

  describe('getDbData log sanitization', () => {
    it('replaces control characters in identifier so log lines cannot be forged', async () => {
      mockTriggerEnforcement(false);

      await controller.getDbData(jwt, query({ identifier: 'x\nforged', trigger: GsTriggerType.MANUAL }));

      expect(verboseSpy).toHaveBeenCalledWith(
        'GS db call: table=asset, identifier=x?forged, trigger=Manual, role=Admin',
      );
    });

    it('truncates oversized identifier values and appends a truncation marker', async () => {
      mockTriggerEnforcement(false);

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
      mockTriggerEnforcement(false);
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
