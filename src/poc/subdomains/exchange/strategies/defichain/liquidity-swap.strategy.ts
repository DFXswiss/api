export interface SwapRequest {
  asset: string;
  amount: number;
}

export abstract class LiquiditySwapStrategy {
  abstract calculateLiquiditySwapAmount(request: SwapRequest): Promise<number>;
}
