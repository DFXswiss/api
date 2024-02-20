import { AltCoin, Bitcoin, ChfStableCoin, Fiat, SpecialCoin, UsdStableCoin, Xmr } from '../domain/enums';

export class PricingUtil {
  static isFiat(asset: string): boolean {
    return Object.values(Fiat).includes(asset as unknown as Fiat);
  }

  static isBTC(asset: string): boolean {
    return Object.values(Bitcoin).includes(asset as unknown as Bitcoin);
  }

  static isAltCoin(asset: string): boolean {
    return Object.values(AltCoin).includes(asset as unknown as AltCoin);
  }

  static isXmr(asset: string): boolean {
    return Object.values(Xmr).includes(asset as unknown as Xmr);
  }

  static isSpecialCoin(asset: string): boolean {
    return Object.values(SpecialCoin).includes(asset as unknown as SpecialCoin);
  }

  static isUsdStableCoin(asset: string): boolean {
    return Object.values(UsdStableCoin).includes(asset as unknown as UsdStableCoin);
  }

  static isChfStableCoin(asset: string): boolean {
    return Object.values(ChfStableCoin).includes(asset as unknown as ChfStableCoin);
  }

  static isKnownAsset(asset: string): boolean {
    return (
      this.isFiat(asset) ||
      this.isBTC(asset) ||
      this.isAltCoin(asset) ||
      this.isSpecialCoin(asset) ||
      this.isUsdStableCoin(asset) ||
      this.isChfStableCoin(asset) ||
      asset === 'DFI'
    );
  }
}
