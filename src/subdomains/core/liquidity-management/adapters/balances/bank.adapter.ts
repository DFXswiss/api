import { Injectable } from '@nestjs/common';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityBalanceIntegration } from '../../interfaces';

@Injectable()
export class BankAdapter implements LiquidityBalanceIntegration {
  getBalance(fiat: Fiat): Promise<LiquidityBalance> {
    if (!(fiat instanceof Fiat)) {
      throw new Error(`BankAdapter supports only Fiat.`);
    }

    return null;
  }
}
