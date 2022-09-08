import { LinkAddress } from '../../link-address.entity';

const defaultLinkAddress: Partial<LinkAddress> = {
  authentication: 'some-authentication',
  existingAddress: 'some-existing-address',
  newAddress: 'some-new-address',
  isCompleted: false,
};

export function createDefaultLinkAddress(): LinkAddress {
  return createCustomLinkAddress({});
}

export function createCustomLinkAddress(customValues: Partial<LinkAddress>): LinkAddress {
  return Object.assign(new LinkAddress(), { ...defaultLinkAddress, ...customValues });
}
