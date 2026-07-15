import { createMock } from '@golevelup/ts-jest';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { LedgerTx } from '../../entities/ledger-tx.entity';
import { LedgerTxRepository } from '../ledger-tx.repository';

describe('LedgerTxRepository', () => {
  let manager: EntityManager;
  let repository: LedgerTxRepository;

  beforeEach(() => {
    manager = createMock<EntityManager>();
    repository = new LedgerTxRepository(manager);
  });

  it('extends the shared BaseRepository', () => {
    expect(repository).toBeInstanceOf(BaseRepository);
  });

  it('binds the injected EntityManager', () => {
    expect(repository.manager).toBe(manager);
  });

  it('manages the LedgerTx entity', () => {
    expect(repository.target).toBe(LedgerTx);
  });
});
