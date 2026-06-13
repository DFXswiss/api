import { createMock } from '@golevelup/ts-jest';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { LedgerLeg } from '../../entities/ledger-leg.entity';
import { LedgerLegRepository } from '../ledger-leg.repository';

describe('LedgerLegRepository', () => {
  let manager: EntityManager;
  let repository: LedgerLegRepository;

  beforeEach(() => {
    manager = createMock<EntityManager>();
    repository = new LedgerLegRepository(manager);
  });

  it('extends the shared BaseRepository', () => {
    expect(repository).toBeInstanceOf(BaseRepository);
  });

  it('binds the injected EntityManager', () => {
    expect(repository.manager).toBe(manager);
  });

  it('manages the LedgerLeg entity', () => {
    expect(repository.target).toBe(LedgerLeg);
  });
});
