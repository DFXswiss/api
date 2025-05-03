import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { L2BridgeEvmClient } from 'src/integration/blockchain/shared/evm/interfaces';
import { isAsset } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../../interfaces';
import { LiquidityActionAdapter } from './liquidity-action.adapter';

enum EvmL2BridgeAdapterCommands {
  /**
   * @note
   * command names should be lower case
   */
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
}

export abstract class EvmL2BridgeAdapter extends LiquidityActionAdapter {
  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    protected readonly l1Client: EvmClient,
    protected readonly l2Client: L2BridgeEvmClient,
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

    if (!isAsset(asset)) {
      throw new Error('EvmBridgeAdapter.checkCompletion(...) supports only Asset instances as an input.');
    }

    try {
      switch (command) {
        case EvmL2BridgeAdapterCommands.DEPOSIT: {
          return await this.l2Client.checkL2BridgeCompletion(order.correlationId, asset);
        }

        case EvmL2BridgeAdapterCommands.WITHDRAW: {
          return await this.l2Client.checkL1BridgeCompletion(order.correlationId, asset);
        }

        default:
          throw new Error(`EvmL2BridgeAdapter.checkCompletion(...) does not support provided command: ${command}`);
      }
    } catch (e) {
      throw new OrderFailedException(e.message);
    }
  }

  validateParams(_command: string, _params: Record<string, unknown>): boolean {
    /**
     * @note
     * no params supported by evm L2 bridge
     */
    return true;
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  /**
   * @note
   * correlationId is the L1 transaction hash and provided by EVM client
   */
  private async deposit(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: l2Asset },
      },
      amount,
    } = order;

    const { type, name } = l2Asset;

    const l1Asset = await this.assetService.getAssetByQuery({ name, type, blockchain: Blockchain.ETHEREUM });
    if (!l1Asset) {
      throw new Error(
        `EvmL2BridgeAdapter.deposit() ${this.system} could not find pair L1 asset for L2 ${l2Asset.uniqueName}`,
      );
    }

    // verify L1 liquidity
    const l1Liquidity =
      type === AssetType.COIN
        ? await this.l1Client.getNativeCoinBalance()
        : await this.l1Client.getTokenBalance(l1Asset);
    if (l1Liquidity < amount)
      throw new OrderNotProcessableException(
        `Not enough liquidity on L1 blockchain for ${name} (balance: ${l1Liquidity}, requested: ${amount})`,
      );

    switch (type) {
      case AssetType.COIN: {
        return this.l2Client.depositCoinOnDex(amount);
      }

      case AssetType.TOKEN: {
        return this.l2Client.depositTokenOnDex(l1Asset, l2Asset, amount);
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
  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      pipeline: {
        rule: { targetAsset: l2Asset },
      },
      amount,
    } = order;

    const { type, name } = l2Asset;

    switch (type) {
      case AssetType.COIN: {
        return this.l2Client.withdrawCoinOnDex(amount);
      }

      case AssetType.TOKEN: {
        const l1Asset = await this.assetService.getAssetByQuery({ name, type, blockchain: Blockchain.ETHEREUM });

        if (!l1Asset) {
          throw new Error(
            `EvmL2BridgeAdapter.withdraw() ${this.system} could not find pair L1 asset for L2 ${l2Asset.uniqueName}`,
          );
        }

        return this.l2Client.withdrawTokenOnDex(l1Asset, l2Asset, amount);
      }

      default:
        throw new Error(
          `EvmL2BridgeAdapter withdraw supports only two types of asset: ${AssetType.COIN}, ${AssetType.TOKEN}. Provided ${type}`,
        );
    }
  }
}
