import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext } from '../entities/liquidity-order.entity';

export interface LiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: string;
  referenceAmount: number;
  targetAsset: Asset;
  options?: LiquidityRequestOptions;
}

export interface LiquidityRequestOptions {
  bypassAvailabilityCheck?: boolean;
  bypassSlippageProtection?: boolean;
  estimatePurchaseFee?: boolean;
}

export interface TransferRequest {
  asset: Asset;
  amount: number;
  destinationAddress: string;
}

export interface LiquidityResponse {
  targetAsset: Asset;
  referenceAsset: Asset;
  targetAmount: number;
  availableAmountInTargetAsset: number;
  maxPurchasableAmountInTargetAsset: number;
  availableAmountInReferenceAsset: number;
  maxPurchasableAmountInReferenceAsset: number;
  currentPurchaseFee?: number;
}
