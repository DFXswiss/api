import { InternalChargebackFeeDto, InternalFeeDto } from '../dto/fee.dto';
import { createDefaultFee } from './fee.entity.mock';

const defaultInternalFeeDto: Partial<InternalFeeDto> = {
  fees: [createDefaultFee()],
  bankFixed: 0,
  bankRate: 0,
  fixed: 0,
  network: 0,
  payoutRefBonus: false,
  rate: 0.01,
};

const defaultInternalChargebackFeeDto: Partial<InternalChargebackFeeDto> = {
  fees: [createDefaultFee()],
  fixed: 0,
  network: 0,
  rate: 0,
  bankFixed: 0,
  bankRate: 0,
};

export function createInternalFeeDto(): InternalFeeDto {
  return createCustomInternalFeeDto({});
}

export function createCustomInternalFeeDto(customValues: Partial<InternalFeeDto>): InternalFeeDto {
  return Object.assign(new InternalFeeDto(), { ...defaultInternalFeeDto, ...customValues });
}

export function createInternalChargebackFeeDto(): InternalChargebackFeeDto {
  return createCustomInternalChargebackFeeDto({});
}

export function createCustomInternalChargebackFeeDto(customValues: Partial<InternalFeeDto>): InternalChargebackFeeDto {
  return Object.assign(new InternalChargebackFeeDto(), { ...defaultInternalChargebackFeeDto, ...customValues });
}
