import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { L2BridgeEvmClient } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { CorrelationId } from '../../../interfaces';
import { LiquidityManagementAdapter } from './liquidity-management.adapter';

enum EvmL2BridgeAdapterCommands {
  /**
   * @note
   * command names should be lower case
   */
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
}

export abstract class EvmL2BridgeAdapter extends LiquidityManagementAdapter {
  protected commands = new Map<
    string,
    (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>
  >();

  constructor(
    system: LiquidityManagementSystem,
    protected readonly client: L2BridgeEvmClient,
    protected readonly assetService: AssetService,
  ) {
    super(system);

    this.commands.set(EvmL2BridgeAdapterCommands.DEPOSIT, this.deposit.bind(this));
    this.commands.set(EvmL2BridgeAdapterCommands.WITHDRAW, this.withdraw.bind(this));
  }

  /**
   * @note
   * correlationId returned from #executeOrder(...) is ignored in case of DFX DEX. correlation is provided by client call (liquidity management)
   */

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      action: { command },
      pipeline: {
        rule: { target: asset },
      },
    } = order;

    if (!(asset instanceof Asset)) {
      throw new Error('EvmBridgeAdapter.checkCompletion(...) supports only Asset instances as an input.');
    }

    try {
      switch (command) {
        case EvmL2BridgeAdapterCommands.DEPOSIT: {
          return await this.client.checkL2BridgeCompletion(order.correlationId);
        }

        case EvmL2BridgeAdapterCommands.WITHDRAW: {
          return await this.client.checkL1BridgeCompletion(order.correlationId);
        }

        default:
          throw new Error(`EvmL2BridgeAdapter.checkCompletion(...) does not support provided command: ${command}`);
      }
    } catch (e) {
      throw new OrderNotProcessableException(e.message);
    }
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  /**
   * @note
   * correlationId is the L1 transaction hash and provided by EVM client
   */
  private async deposit(l1Asset: Asset, amount: number): Promise<CorrelationId> {
    const { type } = l1Asset;

    switch (type) {
      case AssetType.COIN: {
        return this.client.depositCoinOnDex(amount);
      }

      case AssetType.TOKEN: {
        return this.client.depositTokenOnDex(l1Asset, amount);
      }

      default:
        throw new Error(
          `EvmL2BridgeAdapter deposit supports only two types of asset: ${AssetType.COIN}, ${AssetType.TOKEN}. Provided ${type}`,
        );
    }
  }

  /**
   * @note
   * correlationId is the L2 transaction hash and provided by EVM client
   */
  private async withdraw(l2Asset: Asset, amount: number): Promise<CorrelationId> {
    const { dexName, type, chainId } = l2Asset;

    switch (type) {
      case AssetType.COIN: {
        return this.client.withdrawCoinOnDex(amount);
      }

      case AssetType.TOKEN: {
        const l1Token = await this.assetService.getAssetByQuery({
          dexName,
          blockchain: Blockchain.ETHEREUM,
          type,
          chainId,
        });

        return this.client.withdrawTokenOnDex(l1Token, amount);
      }

      default:
        throw new Error(
          `EvmL2BridgeAdapter withdraw supports only two types of asset: ${AssetType.COIN}, ${AssetType.TOKEN}. Provided ${type}`,
        );
    }
  }
}
