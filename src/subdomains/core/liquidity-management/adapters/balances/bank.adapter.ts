import { Injectable } from '@nestjs/common';
import { isFiat } from 'src/shared/models/active';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityBalanceIntegration } from '../../interfaces';

@Injectable()
export class BankAdapter implements LiquidityBalanceIntegration {
  getBalances(fiats: (Fiat & { context: LiquidityManagementContext })[]): Promise<LiquidityBalance[]> {
    if (!fiats.every(isFiat)) {
      throw new Error(`BankAdapter supports only Fiat.`);
    }

    throw new Error(`Method not implemented.`);
  }

  getNumberOfPendingOrders(_fiat: Fiat): Promise<number> {
    throw new Error(`Method not implemented.`);
  }
}
