import { createMock } from '@golevelup/ts-jest';
import { EntityManager } from 'typeorm';
import { RealUnitLegalAcceptanceRepository } from '../repositories/real-unit-legal-acceptance.repository';

describe('RealUnitLegalAcceptanceRepository', () => {
  it('is constructed on the entity manager', () => {
    const repo = new RealUnitLegalAcceptanceRepository(createMock<EntityManager>());

    expect(repo).toBeInstanceOf(RealUnitLegalAcceptanceRepository);
  });
});
