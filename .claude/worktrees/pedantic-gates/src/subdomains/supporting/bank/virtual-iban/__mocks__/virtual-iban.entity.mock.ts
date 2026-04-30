import { createDefaultBank } from '../../bank/__mocks__/bank.entity.mock';
import { VirtualIban } from '../virtual-iban.entity';

const defaultVirtualIban: Partial<VirtualIban> = { iban: 'DE123456', bank: createDefaultBank() };

export function createDefaultVirtualIban(): VirtualIban {
  return createCustomVirtualIban({});
}

export function createCustomVirtualIban(customValues: Partial<VirtualIban>): VirtualIban {
  return Object.assign(new VirtualIban(), { ...defaultVirtualIban, ...customValues });
}
