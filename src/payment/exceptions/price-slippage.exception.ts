export class PriceSlippageError extends Error {
  constructor(fromAsset: string, toAsset: string) {
    const message = `Price Slippage! From asset: ${fromAsset} to asset ${toAsset}`;

    console.error(message);
    super(message);
  }
}
