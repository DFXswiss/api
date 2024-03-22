import { Asset } from './asset/asset.entity';
import { Fiat } from './fiat/fiat.entity';

export type Active = Asset | Fiat;

export function isFiat(active: Active): active is Fiat {
  return active instanceof Fiat;
}

export function isAsset(active: Active): active is Asset {
  return active instanceof Asset;
}

export function activesEqual(a: Active, b: Active): boolean {
  return a.constructor === b.constructor && a.id === b.id;
}
