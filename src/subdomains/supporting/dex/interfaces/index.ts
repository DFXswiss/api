import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrderContext, LiquidityOrderType } from '../entities/liquidity-order.entity';

export type PurchaseLiquidityRequest = GetLiquidityRequest;
export type ReserveLiquidityRequest = GetLiquidityRequest;
export type CheckLiquidityRequest = GetLiquidityRequest;

export interface GetLiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: Asset;
  referenceAmount: number;
  targetAsset: Asset;
}

export interface SellLiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  sellAsset: Asset;
  sellAmount: number;
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
    isEnoughAvailableLiquidity: boolean;
    isSlippageDetected: boolean;
    slippageMessage: string;
  };
}

export interface ReserveLiquidityResult {
  target: {
    asset: Asset;
    amount: number;
  };
}

export interface LiquidityTransactionResult {
  type: LiquidityOrderType;
  target: {
    asset: Asset;
    amount: number;
  };
  fee: {
    asset: Asset;
    amount: number;
  };
}
