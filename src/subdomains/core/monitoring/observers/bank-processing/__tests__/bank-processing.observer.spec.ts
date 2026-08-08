import { createMock } from '@golevelup/ts-jest';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { BankProcessingObserver } from '../bank-processing.observer';
import {
  BANK_PROCESSING_BLOCKS,
  BANK_PROCESSING_RULES,
  BankProcessingBlockKey,
  BankProcessingRule,
} from '../bank-processing.rules';

function emptyRowFor(rules: BankProcessingRule[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  rules.forEach((rule, i) => {
    raw[`cnt_${i}`] = 0;
    raw[`chf_${i}`] = 0;
    if (rule.tolerance != null) {
      raw[`ovd_${i}`] = 0;
      raw[`ovdchf_${i}`] = 0;
    }
  });
  return raw;
}

function createChainableQuery(getRawOne: jest.Mock): Record<string, jest.Mock> {
  const chainableQuery: Record<string, jest.Mock> = {
    select: jest.fn(),
    addSelect: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    setParameters: jest.fn(),
    getRawOne,
  };
  for (const method of ['select', 'addSelect', 'leftJoin', 'where', 'setParameters']) {
    chainableQuery[method].mockReturnValue(chainableQuery);
  }
  return chainableQuery;
}

describe('BankProcessingObserver', () => {
  let observer: BankProcessingObserver;
  let repos: RepositoryFactory;
  let getRawOneByBlock: Record<BankProcessingBlockKey, jest.Mock>;
  let verboseSpy: jest.SpyInstance;

  beforeEach(() => {
    getRawOneByBlock = {
      bankTx: jest.fn().mockResolvedValue(emptyRowFor(BANK_PROCESSING_RULES.filter((r) => r.block === 'bankTx'))),
      buyCryptoFiat: jest
        .fn()
        .mockResolvedValue(emptyRowFor(BANK_PROCESSING_RULES.filter((r) => r.block === 'buyCryptoFiat'))),
      buyCryptoCrypto: jest
        .fn()
        .mockResolvedValue(emptyRowFor(BANK_PROCESSING_RULES.filter((r) => r.block === 'buyCryptoCrypto'))),
      buyFiat: jest.fn().mockResolvedValue(emptyRowFor(BANK_PROCESSING_RULES.filter((r) => r.block === 'buyFiat'))),
      fiatOutput: jest
        .fn()
        .mockResolvedValue(emptyRowFor(BANK_PROCESSING_RULES.filter((r) => r.block === 'fiatOutput'))),
      bankTxReturn: jest
        .fn()
        .mockResolvedValue(emptyRowFor(BANK_PROCESSING_RULES.filter((r) => r.block === 'bankTxReturn'))),
    };

    // buyCrypto is shared by buyCryptoFiat and buyCryptoCrypto — dispatch by alias.
    const buyCryptoQbCalls: jest.Mock[] = [getRawOneByBlock.buyCryptoFiat, getRawOneByBlock.buyCryptoCrypto];
    let buyCryptoCall = 0;

    repos = {
      bankTx: {
        createQueryBuilder: jest.fn().mockImplementation(() => createChainableQuery(getRawOneByBlock.bankTx)),
      },
      buyCrypto: {
        createQueryBuilder: jest.fn().mockImplementation(() => {
          const getRawOne = buyCryptoQbCalls[buyCryptoCall++] ?? getRawOneByBlock.buyCryptoCrypto;
          return createChainableQuery(getRawOne);
        }),
      },
      buyFiat: {
        createQueryBuilder: jest.fn().mockImplementation(() => createChainableQuery(getRawOneByBlock.buyFiat)),
      },
      fiatOutput: {
        createQueryBuilder: jest.fn().mockImplementation(() => createChainableQuery(getRawOneByBlock.fiatOutput)),
      },
      bankTxReturn: {
        createQueryBuilder: jest.fn().mockImplementation(() => createChainableQuery(getRawOneByBlock.bankTxReturn)),
      },
    } as unknown as RepositoryFactory;

    observer = new BankProcessingObserver(createMock<MonitoringService>(), repos);
    verboseSpy = jest.spyOn(DfxLogger.prototype, 'verbose').mockImplementation();
  });

  afterEach(() => {
    verboseSpy.mockRestore();
  });

  it('returns results for all blocks in rule order', async () => {
    const results = await observer.fetch();

    expect(results).toHaveLength(BANK_PROCESSING_RULES.length);
    expect(results.map((r) => r.key)).toEqual(BANK_PROCESSING_RULES.map((r) => r.key));

    for (const blockKey of Object.keys(BANK_PROCESSING_BLOCKS) as BankProcessingBlockKey[]) {
      expect(results.some((r) => r.block === blockKey)).toBe(true);
    }

    expect(repos.bankTx.createQueryBuilder).toHaveBeenCalledWith('bt');
    expect(repos.buyCrypto.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(repos.buyFiat.createQueryBuilder).toHaveBeenCalledWith('bf');
    expect(repos.fiatOutput.createQueryBuilder).toHaveBeenCalledWith('fo');
    expect(repos.bankTxReturn.createQueryBuilder).toHaveBeenCalledWith('btr');
  });

  it('emits heartbeat and per-rule snapshot lines as monitoring interface', async () => {
    // One overdue rule in bankTx block (first rule has tolerance).
    const bankTxRules = BANK_PROCESSING_RULES.filter((r) => r.block === 'bankTx');
    const bankTxRow = emptyRowFor(bankTxRules);
    bankTxRow['ovd_0'] = 2;
    bankTxRow['ovdchf_0'] = 100;
    getRawOneByBlock.bankTx.mockResolvedValue(bankTxRow);

    const results = await observer.fetch();
    const overdue = results.filter((r) => (r.overdueCount ?? 0) > 0).length;

    expect(verboseSpy).toHaveBeenCalledWith(
      `BankProcessing state snapshot: ${BANK_PROCESSING_RULES.length} rule(s), ${overdue} overdue`,
    );
    expect(overdue).toBe(1);

    const ruleSnapshotCalls = verboseSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((msg) => msg.startsWith('BankProcessing rule snapshot: '));

    expect(ruleSnapshotCalls).toHaveLength(BANK_PROCESSING_RULES.length);

    for (const line of ruleSnapshotCalls) {
      const json = line.slice('BankProcessing rule snapshot: '.length);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        ['block', 'chfSum', 'count', 'key', 'label', 'overdueChf', 'overdueCount', 'toleranceMinutes'].sort(),
      );
      expect(typeof parsed.key).toBe('string');
      expect(typeof parsed.block).toBe('string');
      expect(typeof parsed.label).toBe('string');
      expect(typeof parsed.count).toBe('number');
      expect(typeof parsed.chfSum).toBe('number');
      // Display-only rules carry null for overdue/tolerance fields.
      expect(parsed.overdueCount === null || typeof parsed.overdueCount === 'number').toBe(true);
      expect(parsed.overdueChf === null || typeof parsed.overdueChf === 'number').toBe(true);
      expect(parsed.toleranceMinutes === null || typeof parsed.toleranceMinutes === 'number').toBe(true);
    }
  });

  it('throws on block query failure without partial emit or heartbeat', async () => {
    getRawOneByBlock.buyFiat.mockRejectedValue(new Error('db down'));

    const emitSpy = jest.spyOn(observer as unknown as { emit: (d: unknown) => void }, 'emit');

    await expect(observer.fetch()).rejects.toThrow('db down');

    expect(emitSpy).not.toHaveBeenCalled();
    expect(verboseSpy).not.toHaveBeenCalled();
  });
});
