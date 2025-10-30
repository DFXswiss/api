import { FeeInfo } from '../dto/fee.dto';
import { createDefaultFee } from './fee.entity.mock';

const defaultFeeInfo: FeeInfo = {
  fees: [createDefaultFee()],
  dfx: { fixed: 0, rate: 0.01 },
  bank: { fixed: 0, rate: 0 },
  partner: { fixed: 0, rate: 0 },
  network: 0,
  payoutRefBonus: false,
};

const defaultChargebackFeeInfo: FeeInfo = {
  fees: [createDefaultFee()],
  dfx: { fixed: 0, rate: 0 },
  bank: { fixed: 0, rate: 0 },
  partner: { fixed: 0, rate: 0 },
  network: 0,
  payoutRefBonus: false,
};

export function createFeeInfo(): FeeInfo {
  return createCustomFeeInfo({});
}

export function createCustomFeeInfo(customValues: Partial<FeeInfo>): FeeInfo {
  return { ...defaultFeeInfo, ...customValues };
}
export function createChargebackFeeInfo(): FeeInfo {
  return createCustomChargebackFeeInfo({});
}

export function createCustomChargebackFeeInfo(customValues: Partial<FeeInfo>): FeeInfo {
  return { ...defaultChargebackFeeInfo, ...customValues };
}
