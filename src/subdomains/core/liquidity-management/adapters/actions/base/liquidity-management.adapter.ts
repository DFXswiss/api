import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId, LiquidityActionIntegration } from '../../../interfaces';

export abstract class LiquidityManagementAdapter implements LiquidityActionIntegration {
  constructor(protected readonly system: LiquidityManagementSystem) {}

  protected abstract commands: Map<string, Command>;
  abstract checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;
  abstract validateParams(command: string, params: any): boolean;

  async executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      action: { command },
      pipeline: {
        rule: { target },
      },
    } = order;

    if (!(target instanceof Asset) && !(target instanceof Fiat)) {
      throw new Error(
        `LiquidityManagementAdapter for ${this.system} supports only Asset or Fiat instances as an input`,
      );
    }

    try {
      return await this.commands.get(command)(order);
    } catch (e) {
      if (e instanceof OrderNotProcessableException) throw e;

      throw new OrderFailedException(e.message);
    }
  }

  //*** HELPER METHODS ***//

  protected parseActionParams<T>(paramsJsonString: string): T | null {
    try {
      return JSON.parse(paramsJsonString);
    } catch {
      return null;
    }
  }

  get supportedCommands(): string[] {
    return [...this.commands.keys()];
  }
}
