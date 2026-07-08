import { RealUnitAddressConfirmationRepository } from '../repositories/realunit-address-confirmation.repository';

describe('RealUnitAddressConfirmationRepository', () => {
  it('constructs against the provided entity manager', () => {
    const repo = new RealUnitAddressConfirmationRepository({} as any);
    expect(repo).toBeInstanceOf(RealUnitAddressConfirmationRepository);
  });
});
