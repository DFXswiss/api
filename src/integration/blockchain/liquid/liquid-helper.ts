import { fromConfidential, isConfidential } from 'liquidjs-lib/src/address';

export class LiquidHelper {
  static getUnconfidentialAddress(address: string): string {
    return isConfidential(address) ? fromConfidential(address).unconfidentialAddress : address;
  }
}
