import BigNumber from 'bignumber.js';

const STRK_DECIMALS = 18;
const ETH_DECIMALS = 18;

export class StarknetUtil {
  static fromWeiAmount(amount: string | bigint, decimals: number = STRK_DECIMALS): number {
    return new BigNumber(amount.toString()).div(new BigNumber(10).pow(decimals)).toNumber();
  }

  static toWeiAmount(amount: number, decimals: number = STRK_DECIMALS): bigint {
    return BigInt(new BigNumber(amount).times(new BigNumber(10).pow(decimals)).toFixed(0));
  }

  static get strkDecimals(): number {
    return STRK_DECIMALS;
  }

  static get ethDecimals(): number {
    return ETH_DECIMALS;
  }
}
