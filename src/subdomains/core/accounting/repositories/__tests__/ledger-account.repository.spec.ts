import { createMock } from '@golevelup/ts-jest';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountRepository } from '../ledger-account.repository';

describe('LedgerAccountRepository', () => {
  let manager: EntityManager;
  let repository: LedgerAccountRepository;

  beforeEach(() => {
    manager = createMock<EntityManager>();
    repository = new LedgerAccountRepository(manager);
  });

  it('extends the shared BaseRepository', () => {
    expect(repository).toBeInstanceOf(BaseRepository);
  });

  it('binds the injected EntityManager', () => {
    expect(repository.manager).toBe(manager);
  });

  it('manages the LedgerAccount entity', () => {
    expect(repository.target).toBe(LedgerAccount);
  });
});
