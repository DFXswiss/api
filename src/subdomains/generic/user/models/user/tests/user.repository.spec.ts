import { EntityManager } from 'typeorm';
import { UserRepository } from '../user.repository';

describe('UserRepository', () => {
  it('requires the repository boundary explicitly when allocating the next reference', () => {
    const repository = new UserRepository({} as EntityManager);
    const getNextRef = (
      repository as unknown as {
        getNextRef: (repo: UserRepository) => Promise<string>;
      }
    ).getNextRef;

    expect(getNextRef.length).toBe(1);
  });
});
