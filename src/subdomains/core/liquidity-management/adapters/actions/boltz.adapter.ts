import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { createHash } from 'crypto';
import { Config } from 'src/config/config';
import { BitcoinBasedClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-based-client';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { BoltzClient, BoltzSwapStatus, ChainSwapFailedStatuses } from 'src/integration/blockchain/boltz/boltz-client';
import { BoltzService } from 'src/integration/blockchain/boltz/boltz.service';
import { CitreaClient } from 'src/integration/blockchain/citrea/citrea-client';
import { CitreaService } from 'src/integration/blockchain/citrea/citrea.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { isAsset } from 'src/shared/models/active';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderFailedException } from '../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../interfaces';
import { LiquidityActionAdapter } from './base/liquidity-action.adapter';

const BOLTZ_REFERRAL_ID = 'DFX';

export enum BoltzCommands {
  DEPOSIT = 'deposit', // BTC onchain -> cBTC onchain
}

const CORRELATION_PREFIX = {
  DEPOSIT: 'boltz:deposit:',
};

interface SwapTree {
  claimLeaf: { output: string; version: number };
  refundLeaf: { output: string; version: number };
}

interface DepositCorrelationData {
  step: 'btc_sent' | 'claiming';
  swapId: string;
  claimAddress: string;
  lockupAddress: string;
  userLockAmountSats: number;
  claimAmountSats: number;
  btcTxId: string;
  pairHash: string;
  claimTxHash?: string;
  // Refund data (required to recover funds if swap fails)
  swapTree: SwapTree;
  timeoutBlockHeight: number;
  serverPublicKey: string;
}

@Injectable()
export class BoltzAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(BoltzAdapter);

  protected commands = new Map<string, Command>();

  private readonly boltzClient: BoltzClient;
  private readonly bitcoinClient: BitcoinBasedClient;
  private readonly citreaClient: CitreaClient;

  constructor(
    boltzService: BoltzService,
    bitcoinService: BitcoinService,
    citreaService: CitreaService,
    private readonly assetService: AssetService,
    private readonly bitcoinFeeService: BitcoinFeeService,
  ) {
    super(LiquidityManagementSystem.BOLTZ);

    this.boltzClient = boltzService.getDefaultClient();
    this.bitcoinClient = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_OUTPUT);
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
   * 1. Fetch chain pairs to get pairHash
   * 2. Generate preimage + preimageHash
   * 3. Generate secp256k1 refund key pair
   * 4. Create chain swap via API
   * 5. Send BTC to the lockup address
   * 6. Save all data in correlation ID for later claiming
   */
  private async deposit(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const {
      minAmount,
      maxAmount,
      pipeline: {
        rule: { targetAsset: citreaAsset },
      },
    } = order;

    // Validate asset is cBTC on Citrea
    if (citreaAsset.type !== AssetType.COIN || citreaAsset.blockchain !== Blockchain.CITREA) {
      throw new OrderNotProcessableException('Boltz deposit only supports cBTC (native coin) on Citrea');
    }

    // check BTC balance
    const btcBalance = await this.bitcoinClient.getNativeCoinBalance();
    if (btcBalance < minAmount) {
      throw new OrderNotProcessableException(
        `Not enough BTC (balance: ${btcBalance}, min. requested: ${minAmount}, max. requested: ${maxAmount})`,
      );
    }
    const amount = Math.min(btcBalance, maxAmount);

    const claimAddress = this.citreaClient.walletAddress;
    const amountSats = LightningHelper.btcToSat(amount);

    // Step 1: Get chain pairs to extract pairHash
    const pairs = await this.boltzClient.getChainPairs();
    const pairInfo = pairs['BTC']?.['cBTC'];
    if (!pairInfo) {
      throw new OrderNotProcessableException('BTC -> cBTC chain pair not available on Boltz');
    }
    const pairHash = pairInfo.hash;

    // Validate amount against Boltz pair limits
    if (amountSats < pairInfo.limits.minimal) {
      throw new OrderNotProcessableException(
        `Amount ${amountSats} sats below Boltz minimum of ${pairInfo.limits.minimal} sats`,
      );
    }
    if (amountSats > pairInfo.limits.maximal) {
      throw new OrderNotProcessableException(
        `Amount ${amountSats} sats above Boltz maximum of ${pairInfo.limits.maximal} sats`,
      );
    }

    // Step 2: Derive preimage deterministically from order.id
    const { preimageHash } = this.getPreimageData(order.id);

    // Step 3: Derive secp256k1 key pair for BTC refund (deterministic from seed + orderId)
    const refundPublicKey = this.getRefundPublicKey(order.id);

    // Step 4: Create chain swap via Boltz API
    const swap = await this.boltzClient.createChainSwap(
      preimageHash,
      claimAddress,
      amountSats,
      pairHash,
      BOLTZ_REFERRAL_ID,
      refundPublicKey,
    );

    this.logger.info(
      `Boltz chain swap created: id=${swap.id}, lockupAmount=${swap.lockupDetails.amount} sats, ` +
        `claimAmount=${swap.claimDetails.amount} sats, lockup=${swap.lockupDetails.lockupAddress}, ` +
        `claim=${claimAddress}, timeoutBlockHeight=${swap.lockupDetails.timeoutBlockHeight}`,
    );

    // Step 5: Send BTC to the lockup address
    const lockupAmountBtc = LightningHelper.satToBtc(swap.lockupDetails.amount);
    const btcTxId = await this.sendBtcToAddress(swap.lockupDetails.lockupAddress, lockupAmountBtc);

    this.logger.info(`BTC sent to lockup address: txId=${btcTxId}, amount=${lockupAmountBtc} BTC`);

    // Set order tracking fields
    const btcAsset = await this.assetService.getBtcCoin();

    order.inputAmount = lockupAmountBtc;
    order.inputAsset = btcAsset.name;
    order.outputAsset = citreaAsset.name;

    // Step 6: Save correlation data
    const correlationData: DepositCorrelationData = {
      step: 'btc_sent',
      swapId: swap.id,
      claimAddress,
      lockupAddress: swap.lockupDetails.lockupAddress,
      userLockAmountSats: amountSats,
      claimAmountSats: swap.claimDetails.amount,
      btcTxId,
      pairHash,
      swapTree: swap.lockupDetails.swapTree,
      timeoutBlockHeight: swap.lockupDetails.timeoutBlockHeight,
      serverPublicKey: swap.lockupDetails.serverPublicKey,
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
      const correlationData = this.decodeCorrelation(order.correlationId.replace(CORRELATION_PREFIX.DEPOSIT, ''));

      const status = await this.boltzClient.getSwapStatus(correlationData.swapId);

      this.logger.verbose(
        `Boltz swap ${correlationData.swapId}: step=${correlationData.step}, status=${status.status}`,
      );

      if (ChainSwapFailedStatuses.includes(status.status)) {
        const details = [status.failureReason, status.failureDetails].filter(Boolean).join(' - ');
        throw new OrderFailedException(`Boltz swap failed: ${status.status}${details ? ` (${details})` : ''}`);
      }

      switch (correlationData.step) {
        case 'btc_sent':
          return await this.handleBtcSentStep(order, correlationData, status.status);

        case 'claiming':
          return await this.handleClaimingStep(order, correlationData, status.status);

        default:
          throw new OrderFailedException(`Unknown step: ${correlationData.step}`);
      }
    } catch (e) {
      throw e instanceof OrderFailedException ? e : new OrderFailedException(e.message);
    }
  }

  /**
   * Step: btc_sent — waiting for Boltz server to confirm the lockup and prepare cBTC.
   * When server confirms, call helpMeClaim to trigger claiming.
   */
  private async handleBtcSentStep(
    order: LiquidityManagementOrder,
    correlationData: DepositCorrelationData,
    status: BoltzSwapStatus,
  ): Promise<boolean> {
    if (status === BoltzSwapStatus.TRANSACTION_SERVER_CONFIRMED) {
      // Server has confirmed the lockup — request claiming (skip if already called)
      if (!correlationData.claimTxHash) {
        // Derive preimage from order.id
        const { preimage, preimageHash } = this.getPreimageData(order.id);

        const claimResult = await this.boltzClient.claimChainSwap(preimage, `0x${preimageHash}`);

        this.logger.info(`Boltz swap ${correlationData.swapId}: claim called, claimTxHash=${claimResult.txHash}`);

        correlationData.claimTxHash = claimResult.txHash;
      }

      // Advance to claiming step
      correlationData.step = 'claiming';
      order.correlationId = `${CORRELATION_PREFIX.DEPOSIT}${this.encodeCorrelation(correlationData)}`;

      return false;
    }

    // Still waiting for server confirmation
    return false;
  }

  /**
   * Step: claiming — waiting for the claim transaction to be confirmed.
   */
  private async handleClaimingStep(
    order: LiquidityManagementOrder,
    correlationData: DepositCorrelationData,
    status: BoltzSwapStatus,
  ): Promise<boolean> {
    if (status === BoltzSwapStatus.TRANSACTION_CLAIMED) {
      // Use claimAmountSats (cBTC received after Boltz fees), not userLockAmountSats (BTC sent)
      order.outputAmount = LightningHelper.satToBtc(correlationData.claimAmountSats);

      this.logger.info(`Boltz swap ${correlationData.swapId}: claimed successfully, output=${order.outputAmount} cBTC`);

      return true;
    }

    // Still waiting for claim confirmation
    return false;
  }

  //*** HELPERS ***//

  private async sendBtcToAddress(address: string, amount: number): Promise<string> {
    if (!address || address.length < 26 || address.length > 90) {
      throw new OrderFailedException(`Invalid Bitcoin address format: ${address}`);
    }

    const feeRate = await this.bitcoinFeeService.getRecommendedFeeRate();
    const txId = await this.bitcoinClient.sendMany([{ addressTo: address, amount }], feeRate);

    if (!txId) {
      throw new OrderFailedException(`Failed to send BTC to address ${address}`);
    }

    return txId;
  }

  /**
   * Derive preimage deterministically from seed + orderId.
   */
  private getPreimageData(orderId: number): { preimage: string; preimageHash: string } {
    const seed = Config.blockchain.boltz.seed;
    if (!seed) {
      throw new OrderNotProcessableException('BOLTZ_SEED not configured');
    }

    const preimage = Util.createHmac(seed, `boltz:preimage:${orderId}`);
    const preimageHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');

    return { preimage, preimageHash };
  }

  /**
   * Derive refund private key deterministically from seed + orderId.
   * This allows recovery without storing the private key in the database.
   */
  private getRefundPrivateKey(orderId: number): string {
    const seed = Config.blockchain.boltz.seed;
    if (!seed) {
      throw new OrderNotProcessableException('BOLTZ_SEED not configured');
    }

    return Util.createHmac(seed, `boltz:refund:${orderId}`);
  }

  private getRefundPublicKey(orderId: number): string {
    const privateKey = this.getRefundPrivateKey(orderId);
    return Buffer.from(secp256k1.getPublicKey(privateKey, true)).toString('hex');
  }

  private encodeCorrelation(data: DepositCorrelationData): string {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  private decodeCorrelation(encoded: string): DepositCorrelationData {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  }
}
