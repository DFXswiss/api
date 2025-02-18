import { AmountType } from '../utils/util';
import { Asset } from './asset/asset.entity';
import { AssetDto } from './asset/dto/asset.dto';
import { FiatDto } from './fiat/dto/fiat.dto';
import { Fiat } from './fiat/fiat.entity';

export type Active = Asset | Fiat;
export type ActiveDto = AssetDto | FiatDto;

export function isFiat(active: Active): active is Fiat {
  return active instanceof Fiat;
}

export function isAsset(active: Active): active is Asset {
  return active instanceof Asset;
}

export function amountType(active: Active): AmountType {
  return isFiat(active) ? AmountType.FIAT : AmountType.ASSET;
}

export function feeAmountType(active: Active): AmountType {
  return isFiat(active) ? AmountType.FIAT_FEE : AmountType.ASSET_FEE;
}

export function activesEqual(a: Active, b: Active): boolean {
  return a.constructor === b.constructor && a.id === b.id;
}
