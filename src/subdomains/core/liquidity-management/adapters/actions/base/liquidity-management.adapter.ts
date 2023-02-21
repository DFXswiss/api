import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId, LiquidityActionIntegration } from '../../../interfaces';

export abstract class LiquidityManagementAdapter implements LiquidityActionIntegration {
  constructor(private readonly system: LiquidityManagementSystem) {}

  protected abstract commands: Map<string, Command>;
  abstract checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;

  async executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      action: { command },
      pipeline: {
        rule: { target },
      },
      amount,
    } = order;

    if (!(target instanceof Asset) || !(target instanceof Fiat)) {
      throw new Error(`LiquidityManagementAdapter for ${this.system} supports only Asset instances as an input`);
    }

    try {
      return await this.commands.get(command)(target, amount, order.id);
    } catch (e) {
      throw new OrderNotProcessableException(e.message);
    }
  }

  get supportedCommands(): string[] {
    return [...this.commands.keys()];
  }
}
