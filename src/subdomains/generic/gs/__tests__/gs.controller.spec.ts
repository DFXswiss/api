import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import * as processServiceModule from 'src/shared/services/process.service';
import { DbQueryDto } from 'src/subdomains/generic/gs/dto/db-query.dto';
import { SupportTable } from 'src/subdomains/generic/gs/dto/gs.dto';
import { GsTriggerType } from 'src/subdomains/generic/gs/dto/gs-trigger-type.enum';
import { SupportDataQuery } from 'src/subdomains/generic/gs/dto/support-data.dto';
import { GsController } from 'src/subdomains/generic/gs/gs.controller';
import { GsService } from 'src/subdomains/generic/gs/gs.service';
import { TestUtil } from 'src/shared/utils/test.util';

// Direct regression coverage for `GsController`'s private `logAndCheckTrigger` helper (called
// from both handlers). Calling the real controller without the NestJS wrapper lets this suite
// assert the synchronous audit/service side effects before the returned Promise settles. The
// E2E suite separately covers both handlers through NestJS routing and exception mapping.
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
    TestUtil.provideConfig(); // installs a fresh `Config` — the support endpoint switch reads it
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
        const promise = call(query({}));

        // Structural invariant: audit line is emitted and service is never entered before rejection settles.
        expect(verboseSpy).toHaveBeenCalledTimes(1);
        expect(verboseSpy).toHaveBeenCalledWith(
          'GS db call: table=asset, identifier=missing, trigger=missing, role=Admin',
        );
        expect(serviceCall()).not.toHaveBeenCalled();

        await expect(promise).rejects.toBeInstanceOf(BadRequestException);
        await expect(promise).rejects.toThrow('Trigger type is required');
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

  describe('getSupportData', () => {
    const supportQuery = Object.assign(new SupportDataQuery(), { table: SupportTable.USER_DATA, key: 'id', value: 1 });

    it('rejects while the endpoint switch is off, without reaching the GS service', async () => {
      await expect(controller.getSupportData(supportQuery)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.getSupportData).not.toHaveBeenCalled();
    });

    it('ships with the endpoint switch off', () => {
      expect(Config.support.dataEndpointEnabled).toBe(false);
    });

    it('reaches the GS service once the switch is flipped on', async () => {
      Config.support.dataEndpointEnabled = true;

      await controller.getSupportData(supportQuery);

      expect(service.getSupportData).toHaveBeenCalledWith(supportQuery);
    });
  });
});
