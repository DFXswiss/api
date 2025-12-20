import { VirtualIban } from '../virtual-iban.entity';

const defaultVirtualIban: Partial<VirtualIban> = {};

export function createDefaultVirtualIban(): VirtualIban {
  return createCustomVirtualIban({
    iban: 'DE 123456',
  });
}

export function createCustomVirtualIban(customValues: Partial<VirtualIban>): VirtualIban {
  return Object.assign(new VirtualIban(), { ...defaultVirtualIban, ...customValues });
}
