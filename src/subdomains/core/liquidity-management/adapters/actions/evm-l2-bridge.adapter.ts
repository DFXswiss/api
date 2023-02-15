import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId, LiquidityActionIntegration } from '../../interfaces';

@Injectable()
export class EvmL2BridgeAdapter implements LiquidityActionIntegration {
  private _supportedCommands: string[];
  private commands = new Map<string, (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>>();

  constructor() {
    this.commands.set('deposit', this.deposit.bind(this));
    this.commands.set('withdraw', this.withdraw.bind(this));

    this._supportedCommands = [...this.commands.keys()];
  }

  /**
   * @note
   * Returned correlationId is ignored in case of DFX DEX. correlation is provided by client call (liquidity management)
   */
  async executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      action: { command },
      pipeline: {
        rule: { target: asset },
      },
      amount,
    } = order;

    if (!(asset instanceof Asset)) {
      throw new Error('EvmBridgeAdapter supports only Asset instances as an input.');
    }

    try {
      return await this.commands.get(command)(asset, amount, order.id);
    } catch (e) {
      throw new OrderNotProcessableException(e.message);
    }
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    try {
      return false;
    } catch (e) {
      throw new OrderNotProcessableException(e.message);
    }
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  /**
   * @note
   * correlationId is the L1 transaction hash and provided by EVM client
   */
  private async deposit(asset: Asset, amount: number): Promise<CorrelationId> {
    return null;
  }

  /**
   * @note
   * correlationId is the L2 transaction hash and provided by EVM client
   */
  private async withdraw(asset: Asset, amount: number): Promise<CorrelationId> {
    return null;
  }

  get supportedCommands(): string[] {
    return [...this._supportedCommands];
  }
}
