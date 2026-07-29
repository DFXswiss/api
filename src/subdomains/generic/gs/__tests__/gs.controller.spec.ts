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
// controller, not part of the method itself, so a direct `new GsController(mockService)` plus a
// plain method call sidesteps that problem entirely and exercises the actual production code
// path this feature touches.
describe('GsController', () => {
  let service: DeepMocked<GsService>;
  let controller: GsController;
  let verboseSpy: jest.SpyInstance;

  const jwt: JwtPayload = { role: UserRole.ADMIN, ip: '1.2.3.4' };

  // Both handlers check `Process.GS_DB` before `Process.GS_TRIGGER_CHECK`. `Process.GS_DB` must
  // stay enabled (DisabledProcess -> false) here so the pre-existing endpoint-disabled guard
  // never fires and the trigger check is what's actually under test.
  function mockTriggerCheck(disabled: boolean): void {
    jest
      .spyOn(processServiceModule, 'DisabledProcess')
      .mockImplementation((process) => (process === processServiceModule.Process.GS_TRIGGER_CHECK ? disabled : false));
  }

  function query(overrides: Partial<DbQueryDto>): DbQueryDto {
    return Object.assign(new DbQueryDto(), { table: 'asset' }, overrides);
  }

  beforeEach(() => {
    service = createMock<GsService>();
    controller = new GsController(service);
    verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation();
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
        mockTriggerCheck(false);

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
      });

      it('accepts trigger=Manual when the check is enabled', async () => {
        mockTriggerCheck(false);

        await call(query({ trigger: GsTriggerType.MANUAL }));

        expect(serviceCall()).toHaveBeenCalled();
      });

      it('accepts trigger=Auto when the check is enabled', async () => {
        mockTriggerCheck(false);

        await call(query({ trigger: GsTriggerType.AUTO }));

        expect(serviceCall()).toHaveBeenCalled();
      });

      it('accepts a request without trigger when the check is disabled', async () => {
        mockTriggerCheck(true);

        await call(query({}));

        expect(serviceCall()).toHaveBeenCalled();
      });
    });
  }
});
