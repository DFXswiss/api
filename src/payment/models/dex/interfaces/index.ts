import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext } from '../entities/liquidity-order.entity';

export interface LiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: Asset;
  referenceAmount: number;
  targetAsset: Asset;
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

export interface CheckLiquidityResult {
  target: {
    asset: Asset;
    amount: number;
    availableAmount: number;
    maxPurchasableAmount: number;
  };
  reference: {
    asset: Asset;
    amount: number;
    availableAmount: number;
    maxPurchasableAmount: number;
  };
  purchaseFee: {
    asset: Asset;
    amount: number;
  };
  metadata: {
    isEnoughLiquidity: boolean;
    isSlippageDetected: boolean;
  };
}

export interface ReserveLiquidityResult {
  target: {
    asset: Asset;
    amount: number;
  };
}

export interface PurchaseLiquidityResult {
  target: {
    asset: Asset;
    amount: number;
  };
  purchaseFee: {
    asset: Asset;
    amount: number;
  };
}
