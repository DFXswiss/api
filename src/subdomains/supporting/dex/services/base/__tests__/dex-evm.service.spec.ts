import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PriceSlippageException } from '../../../exceptions/price-slippage.exception';
import { LiquidityOrderRepository } from '../../../repositories/liquidity-order.repository';
import { DexEvmService } from '../dex-evm.service';

class DexEvmServiceWrapper extends DexEvmService {}

describe('DexEvmService', () => {
  let client: EvmClient;
  let service: DexEvmService;

  beforeEach(() => {
    client = mock<EvmClient>();
    const evmService = mock<EvmService>();
    jest.spyOn(evmService, 'getDefaultClient').mockReturnValue(client);

    service = new DexEvmServiceWrapper(mock<LiquidityOrderRepository>(), evmService, 'ETH', Blockchain.ETHEREUM);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('swap(...)', () => {
    const swapAsset = createCustomAsset({ dexName: 'USDC' });
    const targetAsset = createCustomAsset({ dexName: 'ETH' });

    it('maps a direct estimateGas slippage revert to PriceSlippageException', async () => {
      const slippageError = {
        reason: 'execution reverted: Too little received',
        error: { reason: 'processing response error' },
      };
      jest.spyOn(client, 'swap').mockRejectedValue(slippageError);

      let error: unknown;
      try {
        await service.swap(swapAsset, 2.5, targetAsset, 0.2);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PriceSlippageException);
      expect((error as PriceSlippageException).message).toBe(
        'Price is higher than indicated. Composite swap 2.5 USDC to ETH.',
      );
    });

    it('rethrows a non-slippage error unchanged', async () => {
      const cause = new Error('RPC unavailable');
      jest.spyOn(client, 'swap').mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.swap(swapAsset, 2.5, targetAsset, 0.2);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause);
    });
  });
});
