import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as ConfigModule from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { RealUnitLegalAcceptance } from '../entities/real-unit-legal-acceptance.entity';
import { RealUnitLegalAgreement } from '../enums/real-unit-legal-agreement.enum';
import { RealUnitLegalService } from '../real-unit-legal.service';
import { RealUnitLegalAcceptanceRepository } from '../repositories/real-unit-legal-acceptance.repository';

describe('RealUnitLegalService', () => {
  let service: RealUnitLegalService;
  let repo: DeepMocked<RealUnitLegalAcceptanceRepository>;

  const userData = Object.assign(new UserData(), { id: 1 });
  const agreement = RealUnitLegalAgreement.DFX_TERMS_AND_CONDITIONS;
  const currentVersion = '20260712';

  function newAcceptance(values: Partial<RealUnitLegalAcceptance>): RealUnitLegalAcceptance {
    return Object.assign(new RealUnitLegalAcceptance(), values);
  }

  // Mocks the per-agreement "latest acceptance" lookup: returns a row for the agreements present in the map
  // (stamped with the given accepted version), null for the rest — i.e. the SQL filter runs per agreement.
  function mockLatestAcceptances(acceptedVersions: Partial<Record<RealUnitLegalAgreement, string>>): void {
    repo.findOne.mockImplementation((options: any) => {
      const requested = options.where.agreement as RealUnitLegalAgreement;
      const version = acceptedVersions[requested];
      return Promise.resolve(version ? newAcceptance({ agreement: requested, version }) : null);
    });
  }

  // The service reads the current version from Config.blockchain.realunit.legalVersions; stub Config (as the
  // payment-webhook spec does) so the unit test controls the "current" version for every agreement.
  beforeAll(() => {
    const legalVersions = Object.fromEntries(Object.values(RealUnitLegalAgreement).map((a) => [a, currentVersion]));
    (ConfigModule as Record<string, unknown>).Config = { blockchain: { realunit: { legalVersions } } };
  });

  beforeEach(() => {
    repo = createMock<RealUnitLegalAcceptanceRepository>();
    service = new RealUnitLegalService(repo);
  });

  describe('getLegalInfo', () => {
    it('reports accepted=false and no acceptedVersion for every agreement when nothing was accepted', async () => {
      mockLatestAcceptances({});

      const info = await service.getLegalInfo(userData);

      expect(info.agreements).toHaveLength(6);
      expect(info.agreements.every((a) => !a.accepted)).toBe(true);
      expect(info.agreements.every((a) => a.acceptedVersion === undefined)).toBe(true);
      expect(info.agreements.every((a) => a.currentVersion === currentVersion)).toBe(true);
      expect(info.allAccepted).toBe(false);
    });

    it('reports accepted=false but surfaces the acceptedVersion when only an older version was accepted', async () => {
      mockLatestAcceptances({ [agreement]: '20250101' });

      const info = await service.getLegalInfo(userData);

      const status = info.agreements.find((a) => a.agreement === agreement)!;
      expect(status.acceptedVersion).toBe('20250101');
      expect(status.currentVersion).toBe(currentVersion);
      expect(status.accepted).toBe(false);
      expect(info.allAccepted).toBe(false);
    });

    it('reports accepted=true when the current version was accepted', async () => {
      mockLatestAcceptances({ [agreement]: currentVersion });

      const info = await service.getLegalInfo(userData);

      const status = info.agreements.find((a) => a.agreement === agreement)!;
      expect(status.accepted).toBe(true);
      expect(status.acceptedVersion).toBe(currentVersion);
      // the other five agreements are still unaccepted, so allAccepted stays false
      expect(info.allAccepted).toBe(false);
    });

    it('aggregates allAccepted=true only when every agreement is on its current version, filtering per agreement in SQL', async () => {
      const all = Object.fromEntries(Object.values(RealUnitLegalAgreement).map((a) => [a, currentVersion])) as Record<
        RealUnitLegalAgreement,
        string
      >;
      mockLatestAcceptances(all);

      const info = await service.getLegalInfo(userData);

      expect(info.agreements.every((a) => a.accepted)).toBe(true);
      expect(info.allAccepted).toBe(true);
      // one SQL-filtered query per agreement, never load-all-then-filter
      expect(repo.findOne).toHaveBeenCalledTimes(6);
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userData: { id: userData.id }, agreement }) }),
      );
    });
  });

  describe('acceptLegal', () => {
    it('stamps the acceptance with the current server-side version (not a client-sent one) and dates it now', async () => {
      repo.exists.mockResolvedValue(false);
      repo.create.mockImplementation((values: any) => newAcceptance(values));
      repo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      mockLatestAcceptances({}); // final getLegalInfo read-back

      const before = Date.now();
      await service.acceptLegal(userData, [agreement]);
      const after = Date.now();

      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0] as RealUnitLegalAcceptance;
      expect(saved.agreement).toBe(agreement);
      expect(saved.version).toBe(currentVersion);
      expect(saved.userData).toBe(userData);
      expect(saved.acceptedDate).toBeInstanceOf(Date);
      expect(saved.acceptedDate.getTime()).toBeGreaterThanOrEqual(before);
      expect(saved.acceptedDate.getTime()).toBeLessThanOrEqual(after);
    });

    it('is idempotent: writes no row when the current version is already accepted', async () => {
      repo.exists.mockResolvedValue(true);
      mockLatestAcceptances({ [agreement]: currentVersion });

      await service.acceptLegal(userData, [agreement]);

      expect(repo.exists).toHaveBeenCalledWith({
        where: { userData: { id: userData.id }, agreement, version: currentVersion },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('deduplicates a repeated agreement in the request to a single write attempt', async () => {
      repo.exists.mockResolvedValue(false);
      repo.create.mockImplementation((values: any) => newAcceptance(values));
      repo.save.mockImplementation((entity: any) => Promise.resolve(entity));
      mockLatestAcceptances({});

      await service.acceptLegal(userData, [agreement, agreement, agreement]);

      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('treats a concurrent unique-violation (SQLSTATE 23505) on insert as a no-op instead of throwing', async () => {
      repo.exists.mockResolvedValue(false);
      repo.create.mockImplementation((values: any) => newAcceptance(values));
      repo.save.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
      mockLatestAcceptances({ [agreement]: currentVersion }); // the parallel winner already committed

      const info = await service.acceptLegal(userData, [agreement]);

      expect(info.agreements.find((a) => a.agreement === agreement)!.accepted).toBe(true);
    });

    it('propagates a non-unique-violation error from the insert', async () => {
      repo.exists.mockResolvedValue(false);
      repo.create.mockImplementation((values: any) => newAcceptance(values));
      repo.save.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

      await expect(service.acceptLegal(userData, [agreement])).rejects.toThrow('connection lost');
    });
  });
});
