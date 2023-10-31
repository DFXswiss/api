import { Altcoin, Bitcoin, ChfStableCoin, Fiat, Specialcoin, UsdStableCoin } from '../domain/enums';

export class PricingUtil {
  static isFiat(asset: string): boolean {
    return Object.values(Fiat).includes(asset as unknown as Fiat);
  }

  static isBTC(asset: string): boolean {
    return Object.values(Bitcoin).includes(asset as unknown as Bitcoin);
  }

  static isAltcoin(asset: string): boolean {
    return Object.values(Altcoin).includes(asset as unknown as Altcoin);
  }

  static isSpecialCoin(asset: string): boolean {
    return Object.values(Specialcoin).includes(asset as unknown as Specialcoin);
  }

  static isUsdStablecoin(asset: string): boolean {
    return Object.values(UsdStableCoin).includes(asset as unknown as UsdStableCoin);
  }

  static isChfStablecoin(asset: string): boolean {
    return Object.values(ChfStableCoin).includes(asset as unknown as ChfStableCoin);
  }

  static isKnownAsset(asset: string): boolean {
    return (
      this.isFiat(asset) ||
      this.isBTC(asset) ||
      this.isAltcoin(asset) ||
      this.isSpecialCoin(asset) ||
      this.isUsdStablecoin(asset) ||
      this.isChfStablecoin(asset) ||
      asset === 'DFI'
    );
  }
}
