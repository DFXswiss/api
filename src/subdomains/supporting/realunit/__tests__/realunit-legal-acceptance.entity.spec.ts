import { getMetadataArgsStorage } from 'typeorm';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { RealUnitLegalAcceptance } from '../entities/realunit-legal-acceptance.entity';

describe('RealUnitLegalAcceptance', () => {
  it('isVersion returns true only for the stored version', () => {
    const acceptance = Object.assign(new RealUnitLegalAcceptance(), { version: '20260712' });

    expect(acceptance.isVersion('20260712')).toBe(true);
    expect(acceptance.isVersion('20260101')).toBe(false);
  });

  it('declares a required ManyToOne relation to UserData', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (r) => r.target === RealUnitLegalAcceptance && r.propertyName === 'userData',
    );

    expect(relation).toBeDefined();
    expect(relation!.relationType).toBe('many-to-one');
    expect((relation!.type as () => unknown)()).toBe(UserData);
    expect(relation!.options.nullable).toBe(false);
  });

  it('enforces one acceptance per user, agreement and version via a unique index', () => {
    const index = getMetadataArgsStorage().indices.find(
      (i) => i.target === RealUnitLegalAcceptance && typeof i.columns === 'function',
    );

    expect(index).toBeDefined();
    expect(index!.unique).toBe(true);

    const columns = (index!.columns as (a: Record<string, unknown>) => unknown[])({
      userData: 'USER_DATA',
      agreement: 'AGREEMENT',
      version: 'VERSION',
    });
    expect(columns).toEqual(['USER_DATA', 'AGREEMENT', 'VERSION']);
  });
});
