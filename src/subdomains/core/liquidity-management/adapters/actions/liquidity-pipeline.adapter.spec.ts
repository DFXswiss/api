import { createMock } from '@golevelup/ts-jest';
import { Equal } from 'typeorm';
import { LiquidityManagementAction } from '../../entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementService } from '../../services/liquidity-management.service';
import { LiquidityPipelineAdapter } from './liquidity-pipeline.adapter';

describe('LiquidityPipelineAdapter', () => {
  let adapter: LiquidityPipelineAdapter;
  let liquidityManagementService: LiquidityManagementService;
  let pipelineRepo: LiquidityManagementPipelineRepository;
  let orderRepo: LiquidityManagementOrderRepository;

  beforeEach(() => {
    liquidityManagementService = createMock<LiquidityManagementService>();
    pipelineRepo = createMock<LiquidityManagementPipelineRepository>();
    orderRepo = createMock<LiquidityManagementOrderRepository>();

    adapter = new LiquidityPipelineAdapter(liquidityManagementService, pipelineRepo, orderRepo);
  });

  describe('buy', () => {
    it('parses the structured balance/min/max suffix appended by the exchange adapters and calls buyLiquidity with the correct amounts', async () => {
      const previousOrderId = 10;
      const order = Object.assign(new LiquidityManagementOrder(), {
        action: Object.assign(new LiquidityManagementAction(), {
          params: JSON.stringify({ assetId: 1, orderIndex: 1, demandOnly: false }),
        }),
        previousOrderId,
      });

      const previousOrder = Object.assign(new LiquidityManagementOrder(), {
        id: previousOrderId,
        errorMessage:
          'Binance: not enough balance for BTC (balance: 0.5, min. requested: 1.2, max. requested: 2.5)',
      });

      jest.spyOn(orderRepo, 'findOneBy').mockResolvedValue(previousOrder);
      const buyLiquidityMock = jest
        .spyOn(liquidityManagementService, 'buyLiquidity')
        .mockResolvedValue({ id: 42 } as Awaited<ReturnType<LiquidityManagementService['buyLiquidity']>>);

      const correlationId = await adapter['buy'](order);

      expect(orderRepo.findOneBy).toHaveBeenCalledWith({ id: Equal(previousOrderId) });
      expect(buyLiquidityMock).toHaveBeenCalledWith(1, expect.closeTo(0.7), expect.closeTo(2.0), true);
      expect(correlationId).toBe('42');
    });
  });
});
