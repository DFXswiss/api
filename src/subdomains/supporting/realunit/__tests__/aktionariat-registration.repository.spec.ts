import { AktionariatRegistrationRepository } from '../repositories/aktionariat-registration.repository';

describe('AktionariatRegistrationRepository', () => {
  it('constructs against the provided entity manager', () => {
    const repo = new AktionariatRegistrationRepository({} as any);
    expect(repo).toBeInstanceOf(AktionariatRegistrationRepository);
  });
});
