import { EntityManager } from 'typeorm';
import { FiatRepublicPayeeRepository } from '../fiat-republic-payee.repository';

describe('FiatRepublicPayeeRepository', () => {
  it('constructs against the provided entity manager', () => {
    const repo = new FiatRepublicPayeeRepository({} as EntityManager);
    expect(repo).toBeInstanceOf(FiatRepublicPayeeRepository);
  });
});
