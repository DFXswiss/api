import { EntityManager } from 'typeorm';
import { FiatRepublicEndUserRepository } from '../fiat-republic-end-user.repository';

describe('FiatRepublicEndUserRepository', () => {
  it('constructs against the provided entity manager', () => {
    const repo = new FiatRepublicEndUserRepository({} as EntityManager);
    expect(repo).toBeInstanceOf(FiatRepublicEndUserRepository);
  });
});
