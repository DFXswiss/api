import { Setting } from '../setting.entity';
import { SettingRepository } from '../setting.repository';

describe('SettingRepository.setDateMax', () => {
  function repositoryWithTransaction(transactionManager: Record<string, jest.Mock>) {
    const repository = Object.create(SettingRepository.prototype) as SettingRepository;
    const outerManager = {
      transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) => callback(transactionManager)),
    };
    Object.defineProperty(repository, 'manager', { value: outerManager });
    jest.spyOn(repository, 'invalidateCache').mockImplementation();
    return { repository, outerManager };
  }

  function transactionManager(existing?: Setting) {
    return {
      query: jest.fn().mockResolvedValue(undefined),
      findOneBy: jest.fn().mockResolvedValue(existing),
      create: jest.fn((_target, value) => Object.assign(new Setting(), value)),
      save: jest.fn().mockImplementation(async (value) => value),
    };
  }

  it('locks before inserting the first value', async () => {
    const manager = transactionManager();
    const { repository } = repositoryWithTransaction(manager);
    const candidate = new Date('2026-07-11T12:00:00.000Z');

    await repository.setDateMax('lastBankFrickDate:1', candidate);

    expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['lastBankFrickDate:1']);
    expect(manager.create).toHaveBeenCalledWith(Setting, {
      key: 'lastBankFrickDate:1',
      value: candidate.toISOString(),
    });
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(manager.findOneBy.mock.invocationCallOrder[0]);
    expect(repository.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('updates an older value while holding the transaction lock', async () => {
    const existing = Object.assign(new Setting(), {
      key: 'lastBankFrickDate:1',
      value: '2026-07-10T12:00:00.000Z',
    });
    const manager = transactionManager(existing);
    const { repository } = repositoryWithTransaction(manager);

    await repository.setDateMax('lastBankFrickDate:1', new Date('2026-07-11T12:00:00.000Z'));

    expect(manager.save).toHaveBeenCalledWith(existing);
    expect(existing.value).toBe('2026-07-11T12:00:00.000Z');
  });

  it.each(['2026-07-11T12:00:00.000Z', '2026-07-12T12:00:00.000Z'])(
    'does not regress an equal or newer value (%s)',
    async (current) => {
      const manager = transactionManager(Object.assign(new Setting(), { key: 'lastBankFrickDate:1', value: current }));
      const { repository } = repositoryWithTransaction(manager);

      await repository.setDateMax('lastBankFrickDate:1', new Date('2026-07-11T12:00:00.000Z'));

      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it('fails closed instead of overwriting a corrupt stored watermark', async () => {
    const manager = transactionManager(
      Object.assign(new Setting(), { key: 'lastBankFrickDate:1', value: 'not-a-date' }),
    );
    const { repository } = repositoryWithTransaction(manager);

    await expect(repository.setDateMax('lastBankFrickDate:1', new Date('2026-07-11T12:00:00.000Z'))).rejects.toThrow(
      "Setting 'lastBankFrickDate:1' does not contain a valid ISO date",
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(repository.invalidateCache).not.toHaveBeenCalled();
  });
});
