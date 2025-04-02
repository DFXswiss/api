import { Fee } from '../entities/fee.entity';

const defaultFee: Partial<Fee> = {
  id: 1,
};

export function createDefaultFee(): Fee {
  return createCustomFee({});
}

export function createCustomFee(customValues: Partial<Fee>): Fee {
  return Object.assign(new Fee(), { ...defaultFee, ...customValues });
}
