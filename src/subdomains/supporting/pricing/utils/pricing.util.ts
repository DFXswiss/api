import { Altcoin, Fiat, USDStableCoin } from '../enums';

export class PricingUtil {
  static isFiat(asset: string): boolean {
    return Object.values(Fiat).includes(asset as unknown as Fiat);
  }

  static isBTC(asset: string): boolean {
    return asset === 'BTC';
  }

  static isAltcoin(asset: string): boolean {
    return Object.values(Altcoin).includes(asset as unknown as Altcoin);
  }

  static isUSDStablecoin(asset: string): boolean {
    return Object.values(USDStableCoin).includes(asset as unknown as USDStableCoin);
  }

  static isKnownAsset(asset: string): boolean {
    return (
      this.isFiat(asset) || this.isBTC(asset) || this.isAltcoin(asset) || this.isUSDStablecoin(asset) || asset === 'DFI'
    );
  }
}
