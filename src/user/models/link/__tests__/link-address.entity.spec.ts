import { LinkAddress } from '../link-address.entity';

describe('LinkAddress', () => {
  it('should set existing, new address and expiration date to tomorrow on create', () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    expect(new LinkAddress().create('existing-address', 'new-address')).toEqual({
      expiration: tomorrow,
      existingAddress: 'existing-address',
      newAddress: 'new-address',
    });
  });

  it('should set is completed to true on complete', () => {
    expect(new LinkAddress().complete()).toEqual({ isCompleted: true });
  });

  it('should return false if date is not expired', () => {
    const linkAddress = new LinkAddress().create('existing-address', 'new-address');
    expect(linkAddress.isExpired()).toBeFalsy();
  });
});
