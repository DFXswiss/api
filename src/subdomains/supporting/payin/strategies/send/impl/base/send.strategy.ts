import { Inject, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import {
  CryptoInput,
  PayInConfirmationType,
  PayInStatus,
} from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SendStrategyRegistry } from './send.strategy-registry';

export type SendGroupKey = string;

export interface SendGroup {
  account: WalletAccount;
  sourceAddress: string;
  destinationAddress: string;
  asset: Asset;
  status: PayInStatus;
  payIns: CryptoInput[];
}

export enum SendType {
  FORWARD = 'Forward',
  RETURN = 'Return',
}

export abstract class SendStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  @Inject() private readonly priceProvider: PricingService;
  @Inject() private readonly payoutService: PayoutService;
  @Inject(forwardRef(() => TransactionHelper)) private readonly transactionHelper: TransactionHelper;
  @Inject() private readonly registry: SendStrategyRegistry;

  onModuleInit() {
    this.registry.add({ blockchain: this.blockchain, assetType: this.assetType }, this);
  }

  onModuleDestroy() {
    this.registry.remove({ blockchain: this.blockchain, assetType: this.assetType });
  }

  abstract get blockchain(): Blockchain;
  abstract get assetType(): AssetType;

  abstract doSend(payIns: CryptoInput[], type: SendType): Promise<void>;
  abstract checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void>;

  protected abstract getForwardAddress(): BlockchainAddress;

  protected updatePayInWithSendData(
    payIn: CryptoInput,
    type: SendType,
    outTxId: string,
    feeAmount: number = null,
  ): CryptoInput | null {
    switch (type) {
      case SendType.FORWARD:
        return payIn.forward(outTxId, feeAmount);

      case SendType.RETURN:
        return payIn.return(outTxId, feeAmount);

      default:
        this.logger.warn(`Unsupported SendType for updating with send data for pay-in ${payIn.id}`);
        return null;
    }
  }

  protected designateSend(payIn: CryptoInput, type: SendType): CryptoInput | null {
    switch (type) {
      case SendType.FORWARD:
        return payIn.designateForward(this.getForwardAddress());

      case SendType.RETURN:
        return payIn.designateReturn();

      default:
        this.logger.warn(`Unsupported SendType for designating send of pay-in ${payIn.id}`);
        return null;
    }
  }

  // --- FEES --- //
  protected async getMinInputFee(asset: Asset): Promise<number> {
    return this.transactionHelper.getBlockchainFee(asset, true);
  }

  protected async getEstimatedFee(
    asset: Asset,
    amount: number,
    targetAddress?: string,
  ): Promise<{ nativeFee: number; targetFee: number }> {
    const nativeFee = await this.payoutService.estimateFee(
      asset,
      targetAddress ?? this.getForwardAddress().address,
      amount,
      asset,
    );
    const targetFee = await this.getFeeAmountInPayInAsset(asset, nativeFee);

    return { nativeFee: nativeFee.amount, targetFee };
  }

  private async getFeeAmountInPayInAsset(asset: Asset, nativeFee: FeeResult): Promise<number> {
    return nativeFee.amount ? this.getFeeReferenceAmount(nativeFee.asset, nativeFee.amount, asset) : 0;
  }

  private async getFeeReferenceAmount(fromAsset: Asset, fromAmount: number, toAsset: Asset): Promise<number> {
    const price = await this.priceProvider.getPrice(fromAsset, toAsset, true);
    return price.convert(fromAmount, 8);
  }
}
