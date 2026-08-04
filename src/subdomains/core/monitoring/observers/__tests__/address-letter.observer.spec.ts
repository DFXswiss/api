import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { LetterService } from 'src/integration/letter/letter.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { FileSubType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { AddressLetterObserver } from '../address-letter.observer';

describe('AddressLetterObserver', () => {
  let observer: AddressLetterObserver;
  let repos: RepositoryFactory;
  let letterService: LetterService;
  let monitoringService: MonitoringService;

  let queries: any[];
  let countBy: jest.Mock;

  // One chainable stub per createQueryBuilder call, so each of the four aggregate queries can be given
  // its own raw result and its own where clauses can be inspected.
  function chainable(rawResult: unknown): any {
    const query: any = { conditions: [] as string[], rawResult };
    for (const method of ['select', 'addSelect']) query[method] = jest.fn(() => query);
    query.leftJoin = jest.fn((_relation: string, _alias: string, condition?: string) => {
      if (condition) query.conditions.push(condition);
      return query;
    });
    for (const method of ['where', 'andWhere'])
      query[method] = jest.fn((condition: string) => {
        query.conditions.push(condition);
        return query;
      });
    query.getRawOne = jest.fn().mockResolvedValue(rawResult);
    return query;
  }

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    queries = [
      chainable({ backlog: '7', oldestUpdated: new Date(Date.now() - 3 * 60 * 60 * 1000) }),
      chainable({ incomplete: '3' }),
      chainable({ exhausted: '1' }),
      chainable({ sentWithoutFile: '2' }),
      chainable({ lastSent: new Date(Date.now() - 2 * 60 * 60 * 1000) }),
    ];

    countBy = jest.fn().mockResolvedValue(4);
    let call = 0;

    // RepositoryFactory is a concrete class whose repositories are plain instance properties, not
    // something createMock deep-mocks - build only the surface the observer touches.
    repos = {
      userData: { createQueryBuilder: jest.fn(() => queries[call++]), countBy },
    } as unknown as RepositoryFactory;

    letterService = createMock<LetterService>();
    monitoringService = createMock<MonitoringService>();

    jest.spyOn(letterService, 'getBalance').mockResolvedValue(123.45);
    Object.defineProperty(letterService, 'isConfigured', { get: () => true, configurable: true });

    observer = new AddressLetterObserver(monitoringService, repos, letterService);
  });

  it('should be defined', () => {
    expect(observer).toBeDefined();
  });

  it('emits every metric the alerting depends on', async () => {
    const data = await observer.fetch();

    expect(data).toEqual({
      backlog: 7,
      oldestAgeHours: 3,
      incompleteAddress: 3,
      exhausted: 1,
      claimedWithoutLetter: 4,
      sentWithoutFile: 2,
      hoursSinceLastLetter: 2,
      letterBalance: 123.45,
    });
  });

  it('counts only accounts the job itself dispatched as missing a document', async () => {
    await observer.fetch();

    const conditions = queries[3].conditions.join(' ');
    expect(conditions).toContain('userData.letterClaimDate IS NOT NULL');
    expect(conditions).toContain('userData.letterSentDate IS NOT NULL');
    // anti-join over the mapped relation, so TypeORM owns table path and quoting
    expect(conditions).toContain('kycFile.id IS NULL');
    // and only a document from THIS dispatch counts - an older PostDispatch file must not hide one
    // this job never stored
    expect(queries[3].leftJoin).toHaveBeenCalledWith(
      'userData.kycFiles',
      'kycFile',
      expect.stringContaining('kycFile.created >= userData.letterClaimDate'),
      expect.objectContaining({ subType: FileSubType.POST_DISPATCH, valid: true }),
    );
  });

  it('keeps accounts without a printable address out of the backlog', async () => {
    await observer.fetch();

    expect(queries[0].conditions).toContain(`NULLIF(BTRIM(userData.street), '') IS NOT NULL`);
    // a blank string is as unprintable as a missing one, and must land in incompleteAddress instead
    expect(queries[1].conditions.join(' ')).toContain(`NULLIF(BTRIM(userData.street), '') IS NULL`);
    expect(queries[1].conditions.join(' ')).toContain(`NULLIF(BTRIM(country.name), '') IS NULL`);
  });

  it('leaves a claimed account out of the servable backlog', async () => {
    await observer.fetch();

    // the job never picks a claimed account up again, so counting it as backlog would report a queue
    // as stalled while nothing is actually waiting for the job
    expect(queries[0].conditions).toContain('userData.letterClaimDate IS NULL');
  });

  it('separates accounts out of retries from the servable backlog', async () => {
    await observer.fetch();

    expect(queries[0].conditions).toContain('userData.letterFailures < :maxFailures');
    expect(queries[2].conditions).toContain('userData.letterFailures >= :maxFailures');
  });

  it('reports no age at all rather than a wrong one when nothing is queued', async () => {
    queries[0].getRawOne.mockResolvedValue({ backlog: '0', oldestUpdated: null });
    queries[4].getRawOne.mockResolvedValue({ lastSent: null });

    const data = await observer.fetch();

    expect(data.backlog).toBe(0);
    expect(data.oldestAgeHours).toBeNull();
    expect(data.hoursSinceLastLetter).toBeNull();
  });

  it('reports an unknown provider balance instead of losing the whole metric set', async () => {
    jest.spyOn(letterService, 'getBalance').mockRejectedValue(new Error('provider down'));

    const data = await observer.fetch();

    expect(data.letterBalance).toBeNull();
    expect(data.backlog).toBe(7);
  });

  it('does not call an unconfigured provider', async () => {
    Object.defineProperty(letterService, 'isConfigured', { get: () => false, configurable: true });

    const data = await observer.fetch();

    expect(letterService.getBalance).not.toHaveBeenCalled();
    expect(data.letterBalance).toBeNull();
  });
});
