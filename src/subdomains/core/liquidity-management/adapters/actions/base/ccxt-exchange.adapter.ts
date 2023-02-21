import { ExchangeService } from 'src/integration/exchange/services/exchange.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { CorrelationId } from '../../../interfaces';
import { LiquidityManagementAdapter } from './liquidity-management.adapter';

export abstract class CctxExchangeAdapter extends LiquidityManagementAdapter {
  protected commands = new Map<
    string,
    (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>
  >();

  constructor(system: LiquidityManagementSystem, private readonly exchangeService: ExchangeService) {
    super(system);

    this.commands.set('deposit', this.deposit.bind(this));
    this.commands.set('withdraw', this.withdraw.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    return false;
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  private async deposit(asset: Asset, amount: number): Promise<CorrelationId> {
    return null;
  }

  private async withdraw(asset: Asset, amount: number): Promise<CorrelationId> {
    return null;
  }
}
