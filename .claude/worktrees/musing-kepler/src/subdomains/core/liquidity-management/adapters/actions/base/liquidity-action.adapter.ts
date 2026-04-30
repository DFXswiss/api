import { isAsset, isFiat } from 'src/shared/models/active';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { OrderNotNecessaryException } from '../../../exceptions/order-not-necessary.exception';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId, LiquidityActionIntegration } from '../../../interfaces';

export abstract class LiquidityActionAdapter implements LiquidityActionIntegration {
  constructor(protected readonly system: LiquidityManagementSystem) {}

  protected abstract commands: Map<string, Command>;
  abstract checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;
  abstract validateParams(command: string, params: Record<string, unknown>): boolean;

  async executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      action: { command },
      pipeline: {
        rule: { target },
      },
    } = order;

    if (!isAsset(target) && !isFiat(target)) {
      throw new Error(
        `LiquidityManagementAdapter for ${this.system} supports only Asset or Fiat instances as an input`,
      );
    }

    try {
      return await this.commands.get(command)(order);
    } catch (e) {
      if (e instanceof OrderNotProcessableException || e instanceof OrderNotNecessaryException) throw e;

      throw new OrderFailedException(e.message);
    }
  }

  //*** HELPER METHODS ***//
  get supportedCommands(): string[] {
    return [...this.commands.keys()];
  }
}
