import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';

const defaultLiquidityBalance: Partial<LiquidityBalance> = {
  id: 1,
  asset: createDefaultAsset(),
  amount: 1000,
  isDfxOwned: true,
};

export function createDefaultLiquidityBalance(): LiquidityBalance {
  return createCustomLiquidityBalance({});
}

export function createCustomLiquidityBalance(customValues: Partial<LiquidityBalance>): LiquidityBalance {
  return Object.assign(new LiquidityBalance(), { ...defaultLiquidityBalance, ...customValues });
}
