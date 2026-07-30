import { createMock } from '@golevelup/ts-jest';
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

    it('passes from, dailySample and includeByType through in order without transposition', async () => {
      const spy = jest.spyOn(dashboardFinancialService, 'getFinancialLog').mockResolvedValue(emptyResponse);

      await controller.getFinancialLog('2026-06-15T00:00:00.000Z', 'false', 'true');

      expect(spy).toHaveBeenCalledWith(new Date('2026-06-15T00:00:00.000Z'), false, true);
    });
  });
});
