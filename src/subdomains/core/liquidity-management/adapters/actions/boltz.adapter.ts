import { Injectable } from '@nestjs/common';
import {
  BoltzClient,
  ReverseSwapFailedStatuses,
  ReverseSwapSuccessStatuses,
} from 'src/integration/blockchain/boltz/boltz-client';
import { BoltzService } from 'src/integration/blockchain/boltz/boltz.service';
import { CitreaClient } from 'src/integration/blockchain/citrea/citrea-client';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { isAsset } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

export enum BoltzCommands {
  DEPOSIT = 'deposit', // BTC -> cBTC via Boltz Reverse Swap
}

const CORRELATION_PREFIX = {
  DEPOSIT: 'boltz:deposit:',
};

interface DepositCorrelationData {
  swapId: string;
  claimAddress: string;
  invoiceAmountSats: number;
}

@Injectable()
export class BoltzAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(BoltzAdapter);

  protected commands = new Map<string, Command>();

  private readonly boltzClient: BoltzClient;
  private readonly citreaClient: CitreaClient;

  constructor(
    boltzService: BoltzService,
    citreaService: CitreaService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.BOLTZ);

    this.boltzClient = boltzService.getDefaultClient();
    this.citreaClient = citreaService.getDefaultClient<CitreaClient>();

    this.commands.set(BoltzCommands.DEPOSIT, this.deposit.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      action: { command },
    } = order;

    if (command === BoltzCommands.DEPOSIT) {
      return this.checkDepositCompletion(order);
    }

    throw new OrderFailedException(`Unknown command: ${command}`);
  }

  validateParams(_command: string, _params: Record<string, unknown>): boolean {
    return true;
  }

  //*** COMMANDS ***//

  /**
   * Deposit BTC -> cBTC via Boltz Reverse Swap.
   * Creates a reverse swap on Lightning.space, which will send cBTC to the claim address
   * once the Lightning invoice is paid.
   */
  private async deposit(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      maxAmount,
      pipeline: {
        rule: { targetAsset: citreaAsset },
      },
    } = order;

    // Validate asset is cBTC on Citrea
    if (citreaAsset.type !== AssetType.COIN || citreaAsset.blockchain !== Blockchain.CITREA) {
      throw new OrderNotProcessableException('Boltz deposit only supports cBTC (native coin) on Citrea');
    }

    const claimAddress = this.citreaClient.walletAddress;
    const invoiceAmountSats = Math.round(maxAmount * 1e8);

    // Create reverse swap via Boltz API
    const swap = await this.boltzClient.createReverseSwap(claimAddress, invoiceAmountSats);

    this.logger.info(
      `Boltz reverse swap created: id=${swap.id}, amount=${invoiceAmountSats} sats, claimAddress=${claimAddress}`,
    );

    // Get asset names for order tracking
    const btcAsset = await this.assetService.getBtcCoin();

    order.inputAmount = maxAmount;
    order.inputAsset = btcAsset.name;
    order.outputAsset = citreaAsset.name;

    const correlationData: DepositCorrelationData = {
      swapId: swap.id,
      claimAddress,
      invoiceAmountSats,
    };

    return `${CORRELATION_PREFIX.DEPOSIT}${this.encodeCorrelation(correlationData)}`;
  }

  //*** COMPLETION CHECKS ***//

  private async checkDepositCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    const {
      pipeline: {
        rule: { target: asset },
      },
    } = order;

    if (!isAsset(asset)) {
      throw new Error('BoltzAdapter.checkDepositCompletion(...) supports only Asset instances as an input.');
    }

    try {
      const correlationData = this.decodeCorrelation(
        order.correlationId.replace(CORRELATION_PREFIX.DEPOSIT, ''),
      );

      const status = await this.boltzClient.getSwapStatus(correlationData.swapId);

      this.logger.verbose(`Boltz swap ${correlationData.swapId}: status=${status.status}`);

      if (ReverseSwapFailedStatuses.includes(status.status)) {
        throw new OrderFailedException(
          `Boltz swap failed: ${status.status}${status.failureReason ? ` (${status.failureReason})` : ''}`,
        );
      }

      if (ReverseSwapSuccessStatuses.includes(status.status)) {
        order.outputAmount = correlationData.invoiceAmountSats / 1e8;
        return true;
      }

      return false;
    } catch (e) {
      throw e instanceof OrderFailedException ? e : new OrderFailedException(e.message);
    }
  }

  //*** HELPERS ***//

  private encodeCorrelation(data: DepositCorrelationData): string {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  private decodeCorrelation(encoded: string): DepositCorrelationData {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  }
}
