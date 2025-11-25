import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

export enum ScryptAdapterCommands {
  WITHDRAW = 'withdraw',
}

@Injectable()
export class ScryptAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(ScryptAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    private readonly scryptService: ScryptService,
    private readonly dexService: DexService,
  ) {
    super(LiquidityManagementSystem.SCRYPT);

    this.commands.set(ScryptAdapterCommands.WITHDRAW, this.withdraw.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    switch (order.action.command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.checkWithdrawCompletion(order);

      default:
        return false;
    }
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case ScryptAdapterCommands.WITHDRAW:
        return this.validateWithdrawParams(params);

      default:
        throw new Error(`Command ${command} not supported by ScryptAdapter`);
    }
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async withdraw(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { address, asset, blockchain } = this.parseWithdrawParams(order.action.paramMap);

    const token = asset ?? order.pipeline.rule.targetAsset.dexName;

    const balance = await this.scryptService.getAvailableBalance(token);
    if (order.minAmount > balance) {
      throw new OrderNotProcessableException(
        `Scrypt: not enough balance for ${token} (balance: ${balance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Util.floor(Math.min(order.maxAmount, balance), 6);

    order.inputAmount = amount;
    order.inputAsset = token;
    order.outputAsset = token;

    try {
      const response = await this.scryptService.withdrawFunds(token, amount, address);

      return response.id;
    } catch (e) {
      if (this.isBalanceTooLowError(e)) {
        throw new OrderNotProcessableException(e.message);
      }

      throw e;
    }
  }

  // --- COMPLETION CHECKS --- //

  private async checkWithdrawCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { targetAsset },
      },
      action: { paramMap },
      correlationId,
    } = order;

    const { asset, blockchain } = this.parseWithdrawParams(paramMap);
    const token = asset ?? targetAsset.dexName;

    const withdrawal = await this.scryptService.getWithdrawalStatus(correlationId);
    if (!withdrawal) {
      this.logger.verbose(`No withdrawal for clReqId ${correlationId} at Scrypt found`);
      return false;
    }

    if (withdrawal.status === 'Failed' || withdrawal.status === 'Rejected') {
      throw new OrderFailedException(`Withdrawal ${correlationId} has failed with status: ${withdrawal.status}`);
    }

    if (withdrawal.status !== 'Complete') {
      this.logger.verbose(`Withdrawal ${correlationId} status: ${withdrawal.status}`);
      return false;
    }

    order.outputAmount = withdrawal.amount ?? order.inputAmount;

    // For crypto withdrawals, verify on-chain completion
    if (blockchain) {
      // Scrypt doesn't return txid, so we consider Complete status as done
      return true;
    }

    return true;
  }

  // --- PARAM VALIDATION --- //

  private validateWithdrawParams(params: Record<string, unknown>): boolean {
    try {
      this.parseWithdrawParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseWithdrawParams(params: Record<string, unknown>): {
    address: string;
    asset?: string;
    blockchain?: Blockchain;
  } {
    const address = process.env[params.destinationAddress as string];
    const asset = params.asset as string | undefined;
    const blockchain = params.destinationBlockchain as Blockchain | undefined;

    if (!address) {
      throw new Error(`Params provided to ScryptAdapter.withdraw(...) command are invalid.`);
    }

    return { address, asset, blockchain };
  }

  // --- HELPER METHODS --- //

  private isBalanceTooLowError(e: Error): boolean {
    return ['Insufficient funds', 'insufficient balance', 'not enough balance'].some((m) => e.message?.includes(m));
  }
}
