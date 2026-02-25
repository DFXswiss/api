import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import {
  BoltzClient,
  ChainSwapFailedStatuses,
  ChainSwapSuccessStatuses,
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
  DEPOSIT = 'deposit', // BTC onchain -> cBTC onchain via Boltz Chain Swap
}

const CORRELATION_PREFIX = {
  DEPOSIT: 'boltz:deposit:',
};

interface DepositCorrelationData {
  swapId: string;
  claimAddress: string;
  lockupAddress: string;
  userLockAmountSats: number;
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
   * Deposit BTC -> cBTC via Boltz Chain Swap.
   * Creates a chain swap on Lightning.space (BTC onchain -> cBTC on Citrea).
   * Boltz provides a lockup address where BTC must be sent.
   * After confirmation, Boltz sends cBTC to the claim address on Citrea.
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
    const userLockAmountSats = Math.round(maxAmount * 1e8);

    // Generate preimage hash (required by Boltz Chain Swap API)
    const preimage = randomBytes(32);
    const preimageHash = createHash('sha256').update(preimage).digest('hex');

    // Create chain swap via Boltz API
    const swap = await this.boltzClient.createChainSwap(preimageHash, claimAddress, userLockAmountSats);

    this.logger.info(
      `Boltz chain swap created: id=${swap.id}, amount=${userLockAmountSats} sats, ` +
        `lockup=${swap.lockupDetails.lockupAddress}, claim=${claimAddress}`,
    );

    // Get asset names for order tracking
    const btcAsset = await this.assetService.getBtcCoin();

    order.inputAmount = maxAmount;
    order.inputAsset = btcAsset.name;
    order.outputAsset = citreaAsset.name;

    const correlationData: DepositCorrelationData = {
      swapId: swap.id,
      claimAddress,
      lockupAddress: swap.lockupDetails.lockupAddress,
      userLockAmountSats,
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

      if (ChainSwapFailedStatuses.includes(status.status)) {
        throw new OrderFailedException(
          `Boltz swap failed: ${status.status}${status.failureReason ? ` (${status.failureReason})` : ''}`,
        );
      }

      if (ChainSwapSuccessStatuses.includes(status.status)) {
        order.outputAmount = correlationData.userLockAmountSats / 1e8;
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
