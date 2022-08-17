import { LinkAddress } from '../link-address.entity';
import { createCustomLinkAddress } from './mock/link-address.entity.mock';

describe('LinkAddress', () => {
  it('should set existing, new address and expiration date to tomorrow on create', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const linkAddress = LinkAddress.create('existing-address', 'new-address');
    expect(linkAddress.existingAddress).toStrictEqual('existing-address');
    expect(linkAddress.newAddress).toStrictEqual('new-address');
    expect(linkAddress.expiration.getTime()).toBeGreaterThan(Date.now());
    expect(linkAddress.expiration.getTime()).toBeLessThanOrEqual(tomorrow.getTime() + 100); // + 100 to make it more stable
  });

  it('should set is completed to true on complete', () => {
    expect(new LinkAddress().complete()).toEqual({ isCompleted: true });
  });

  it('should return false if date is not expired', () => {
    const linkAddress = LinkAddress.create('existing-address', 'new-address');
    expect(linkAddress.isExpired()).toBeFalsy();
  });

  it('should return true if date is expired', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const linkAddress = createCustomLinkAddress({ expiration: yesterday });
    expect(linkAddress.isExpired()).toBeTruthy();
  });
});
