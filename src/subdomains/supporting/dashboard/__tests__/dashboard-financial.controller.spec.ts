import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { hasRoleAccess } from 'src/shared/auth/role.guard';
import { KycGatedRoles, UserRole } from 'src/shared/auth/user-role.enum';
import { DashboardFinancialController } from '../dashboard-financial.controller';
import { DashboardFinancialService } from '../dashboard-financial.service';
import { FinancialLogResponseDto } from '../dto/financial-log.dto';

describe('DashboardFinancialController', () => {
  let controller: DashboardFinancialController;
  let dashboardFinancialService: DashboardFinancialService;

  beforeEach(async () => {
    dashboardFinancialService = createMock<DashboardFinancialService>();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardFinancialController],
      providers: [{ provide: DashboardFinancialService, useValue: dashboardFinancialService }],
    }).compile();

    controller = module.get<DashboardFinancialController>(DashboardFinancialController);
  });

  describe('getFinancialLog', () => {
    const from = '2026-07-01T00:00:00.000Z';
    const emptyResponse: FinancialLogResponseDto = { entries: [] };

    it.each([
      { byType: undefined as string | undefined, expected: true, label: 'omitted' },
      { byType: '', expected: true, label: "empty string ''" },
      { byType: 'true', expected: true, label: "'true'" },
      { byType: '0', expected: true, label: "'0'" },
      { byType: 'False', expected: true, label: "'False'" },
      { byType: 'false', expected: false, label: "'false'" },
    ])(
      'forwards includeByType=$expected when byType is $label (and from/dailySample unchanged)',
      async ({ byType, expected }) => {
        const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

        if (byType === undefined) {
          await controller.getFinancialLog(from, 'true');
        } else {
          await controller.getFinancialLog(from, 'true', byType);
        }

        expect(spy).toHaveBeenCalledWith(new Date(from), true, expected);
      },
    );

    it.each([
      { dailySample: undefined as string | undefined, expected: true, label: 'omitted' },
      { dailySample: '', expected: true, label: "empty string ''" },
      { dailySample: 'true', expected: true, label: "'true'" },
      { dailySample: '0', expected: true, label: "'0'" },
      { dailySample: 'False', expected: true, label: "'False'" },
      { dailySample: 'false', expected: false, label: "'false'" },
    ])(
      'forwards dailySample=$expected when dailySample is $label (byType held at the opposite value)',
      async ({ dailySample, expected }) => {
        const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);
        const byType = expected ? 'false' : 'true';

        await controller.getFinancialLog(from, dailySample, byType);

        expect(spy).toHaveBeenCalledWith(new Date(from), expected, !expected);
      },
    );

    it('passes from, dailySample and includeByType through in order without transposition', async () => {
      const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

      await controller.getFinancialLog('2026-06-15T00:00:00.000Z', 'false', 'true');

      expect(spy).toHaveBeenCalledWith(new Date('2026-06-15T00:00:00.000Z'), false, true);
    });

    it.each([
      { from: undefined as string | undefined, label: 'omitted' },
      { from: '', label: "empty string ''" },
    ])('passes undefined to the service when from is $label', async ({ from }) => {
      const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

      await controller.getFinancialLog(from, 'true', 'true');

      expect(spy).toHaveBeenCalledWith(undefined, true, true);
    });

    it('throws BadRequestException and does not call the service when from is not a valid date', async () => {
      const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

      await expect(controller.getFinancialLog('not-a-date', 'true', 'true')).rejects.toThrow(BadRequestException);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('role gates', () => {
    function rolesOf(handler: keyof DashboardFinancialController): UserRole[] {
      const guards = Reflect.getMetadata(GUARDS_METADATA, DashboardFinancialController.prototype[handler]) ?? [];
      const roleGuard = guards.find((guard: object) => 'entryRoles' in guard) as { entryRoles: UserRole[] };
      return roleGuard?.entryRoles ?? [];
    }

    // The Financial Overview screen reads exactly these two. Pinned as a set,
    // not with toContain: the point of this block is the upper bound. With
    // toContain, adding Support or Compliance later would stay green — and
    // both sit in KycGatedRoles, so the clearance test below would not catch
    // it either. Sorted so decorator order stays free to change.
    it.each(['getFinancialLog', 'getLatestBalance'] as const)('%s admits exactly Admin and Debug', (handler) => {
      expect([...rolesOf(handler)].sort()).toEqual([UserRole.ADMIN, UserRole.DEBUG].sort());
    });

    // Widening must not reach further than the overview. ref-recipients in
    // particular returns userDataId per recipient — a reference to a person,
    // not an aggregate.
    it.each(['getLatestChanges', 'getRefRewardRecipients', 'getFinancialChanges'] as const)(
      '%s stays Admin-only',
      (handler) => {
        expect(rolesOf(handler)).toEqual([UserRole.ADMIN]);
      },
    );

    it('keeps the staff KYC gate on the widened endpoints', () => {
      // RoleGuard applies the clearance only when EVERY entry role is KYC-gated.
      // Adding a non-gated role here would silently drop that requirement.
      for (const handler of ['getFinancialLog', 'getLatestBalance'] as const) {
        expect(rolesOf(handler).every((role) => KycGatedRoles.includes(role))).toBe(true);
      }
    });

    it('does not make Debug a super-role of Admin elsewhere', () => {
      // The hierarchy is one-way: an Admin satisfies a Debug requirement, not
      // the reverse. This change opens two endpoints, it does not promote Debug.
      expect(hasRoleAccess(UserRole.DEBUG, UserRole.ADMIN)).toBe(true);
      expect(hasRoleAccess(UserRole.ADMIN, UserRole.DEBUG)).toBe(false);
    });
  });
});
