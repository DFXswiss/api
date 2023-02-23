import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeService } from 'src/integration/exchange/services/exchange.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { Command, CorrelationId } from '../../../interfaces';
import { LiquidityManagementAdapter } from './liquidity-management.adapter';

export interface CcxtExchangeWithdrawParams {
  destinationBlockchain: Blockchain;
  destinationAddress: string;
  destinationAddressKey: string;
}

/**
 * @note
 * commands should be lower-case
 */
export enum CcxtExchangeAdapterCommands {
  WITHDRAW = 'withdraw',
}

export abstract class CcxtExchangeAdapter extends LiquidityManagementAdapter {
  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    private readonly exchangeService: ExchangeService,
    private readonly dexService: DexService,
  ) {
    super(system);

    this.commands.set(CcxtExchangeAdapterCommands.WITHDRAW, this.withdraw);
  }

  protected abstract mapBlockchainToCcxtNetwork(blockchain: Blockchain): string;

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { targetAsset: asset },
      },
      amount,
    } = order;

    const request = { asset, amount, since: order.created };
    const transaction = await this.dexService.findTransaction(request);

    if (!transaction || !transaction.isComplete) return false;

    return true;
  }

  validateParams(command: string, params: any): boolean {
    switch (command) {
      case CcxtExchangeAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      default:
        throw new Error(`Command ${command} not supported by CcxtExchangeAdapter`);
    }
  }

  //*** COMMANDS IMPLEMENTATIONS ***//

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, key, network } = this.parseAndValidateParams(order.action.params);

    const token = order.pipeline.rule.targetAsset.dexName;
    const { amount } = order;

    const response = await this.exchangeService.withdrawFunds(token, amount, address, key, network);

    return response.id;
  }

  //*** HELPER METHODS ***//

  private parseAndValidateParams(_params: any): { address: string; key: string; network: string } {
    const params = this.parseActionParams<CcxtExchangeWithdrawParams>(_params);
    const isValid = this.validateWithdrawParams(params);

    if (!isValid) throw new Error(`Params provided to CcxtExchangeAdapter.withdraw(...) command are invalid.`);

    return this.mapWithdrawParams(params);
  }

  private validateWithdrawParams(params: any): boolean {
    try {
      const { address, key, network } = this.mapWithdrawParams(params);

      return !!(address && key && network);
    } catch {
      return false;
    }
  }

  private mapWithdrawParams(params: CcxtExchangeWithdrawParams): { address: string; key: string; network: string } {
    const address = process.env[params.destinationAddress];
    const key = process.env[params.destinationAddressKey];
    const network = this.mapBlockchainToCcxtNetwork(params.destinationBlockchain);

    return { address, key, network };
  }
}
