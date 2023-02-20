import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmClientRegistryService } from 'src/integration/blockchain/shared/evm/evm-client-registry.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId, LiquidityActionIntegration } from '../../interfaces';

/**
 * @note
 * lower case for command names
 */
enum EvmL2BridgeAdapterCommands {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdraw',
}
@Injectable()
export class EvmL2BridgeAdapter implements LiquidityActionIntegration {
  private _supportedCommands: string[];
  private commands = new Map<string, (asset: Asset, amount: number, correlationId: number) => Promise<CorrelationId>>();

  constructor(private readonly registry: EvmClientRegistryService, private readonly assetService: AssetService) {
    this.commands.set(EvmL2BridgeAdapterCommands.DEPOSIT, this.deposit.bind(this));
    this.commands.set(EvmL2BridgeAdapterCommands.WITHDRAWAL, this.withdraw.bind(this));

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
      throw new Error('EvmBridgeAdapter.executeOrder(...) supports only Asset instances as an input.');
    }

    try {
      return await this.commands.get(command)(asset, amount, order.id);
    } catch (e) {
      throw new OrderNotProcessableException(e.message);
    }
  }

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

    const l2BridgeEvmClient = this.registry.getL2BridgeEvmClient(asset.blockchain);

    try {
      switch (command) {
        case EvmL2BridgeAdapterCommands.DEPOSIT: {
          return await l2BridgeEvmClient.checkL2BridgeCompletion(order.correlationId);
        }

        case EvmL2BridgeAdapterCommands.WITHDRAWAL: {
          return await l2BridgeEvmClient.checkL1BridgeCompletion(order.correlationId);
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
    const { type, blockchain } = l1Asset;
    const l2BridgeEvmClient = this.registry.getL2BridgeEvmClient(blockchain);

    switch (type) {
      case AssetType.COIN: {
        return l2BridgeEvmClient.depositCoinOnDex(amount);
      }

      case AssetType.TOKEN: {
        return l2BridgeEvmClient.depositTokenOnDex(l1Asset, amount);
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
    const { dexName, type, blockchain, chainId } = l2Asset;
    const l2BridgeEvmClient = this.registry.getL2BridgeEvmClient(blockchain);

    switch (type) {
      case AssetType.COIN: {
        return l2BridgeEvmClient.withdrawCoinOnDex(amount);
      }

      case AssetType.TOKEN: {
        const l1Token = await this.assetService.getAssetByQuery({
          dexName,
          blockchain: Blockchain.ETHEREUM,
          type,
          chainId,
        });

        return l2BridgeEvmClient.withdrawTokenOnDex(l1Token, amount);
      }

      default:
        throw new Error(
          `EvmL2BridgeAdapter withdraw supports only two types of asset: ${AssetType.COIN}, ${AssetType.TOKEN}. Provided ${type}`,
        );
    }
  }

  get supportedCommands(): string[] {
    return [...this._supportedCommands];
  }
}
