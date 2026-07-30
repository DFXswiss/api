import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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

    it('passes undefined to the service when from is omitted', async () => {
      const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

      await controller.getFinancialLog(undefined, 'true', 'true');

      expect(spy).toHaveBeenCalledWith(undefined, true, true);
    });

    it('throws BadRequestException and does not call the service when from is not a valid date', async () => {
      const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

      await expect(controller.getFinancialLog('not-a-date', 'true', 'true')).rejects.toThrow(BadRequestException);

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
