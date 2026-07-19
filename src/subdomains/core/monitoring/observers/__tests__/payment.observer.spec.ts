import { createMock } from '@golevelup/ts-jest';
import { FrickPaymentState } from 'src/integration/bank/dto/frick.dto';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { FindOperator, In, IsNull, LessThan, Not } from 'typeorm';
import { PaymentObserver } from '../payment.observer';

// Evaluates a TypeORM FindOptionsWhere-shaped clause (with real FindOperator instances, e.g. from
// IsNull()/Not()/LessThan()) against a plain synthetic row, so tests can assert on-clause-matching
// behavior instead of just the constructed query shape.
function matchesOperator(op: FindOperator<unknown>, actual: unknown): boolean {
  switch (op.type) {
    case 'isNull':
      return actual == null;
    case 'not': {
      const child = op.child;
      return child ? !matchesOperator(child, actual) : actual !== op.value;
    }
    case 'lessThan':
      return actual != null && (actual as number | Date) < (op.value as number | Date);
    case 'in':
      return Array.isArray(op.value) && op.value.includes(actual);
    default:
      throw new Error(`Unsupported operator "${op.type}" in test matcher`);
  }
}

function matchesClause(clause: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.keys(clause).every((key) => {
    const expected = clause[key];
    return expected instanceof FindOperator ? matchesOperator(expected, row[key]) : row[key] === expected;
  });
}

function countMatching(
  where: Record<string, unknown> | Record<string, unknown>[],
  rows: Record<string, unknown>[],
): number {
  const clauses = Array.isArray(where) ? where : [where];
  return rows.filter((row) => clauses.some((clause) => matchesClause(clause, row))).length;
}

describe('PaymentObserver', () => {
  let observer: PaymentObserver;
  let repos: RepositoryFactory;

  beforeEach(() => {
    const chainableQuery: Record<string, jest.Mock> = {
      select: jest.fn(),
      addSelect: jest.fn(),
      leftJoin: jest.fn(),
      where: jest.fn(),
      groupBy: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of ['select', 'addSelect', 'leftJoin', 'where', 'groupBy']) {
      chainableQuery[method].mockReturnValue(chainableQuery);
    }

    // RepositoryFactory is a concrete class whose nested repositories are plain instance properties,
    // not something @golevelup/ts-jest's createMock deep-mocks automatically - build only the surface
    // getPayment() actually touches.
    repos = {
      deposit: { createQueryBuilder: jest.fn().mockReturnValue(chainableQuery) },
      buyCrypto: { findOne: jest.fn().mockResolvedValue(undefined), countBy: jest.fn().mockResolvedValue(0) },
      buyFiat: { findOne: jest.fn().mockResolvedValue(undefined), countBy: jest.fn().mockResolvedValue(0) },
      bankTx: { countBy: jest.fn().mockResolvedValue(0) },
      payIn: { countBy: jest.fn().mockResolvedValue(0) },
      refReward: { countBy: jest.fn().mockResolvedValue(0) },
      paymentQuote: { countBy: jest.fn().mockResolvedValue(0) },
      custodyOrder: { countBy: jest.fn().mockResolvedValue(0) },
      fiatOutput: { countBy: jest.fn().mockResolvedValue(0) },
    } as unknown as RepositoryFactory;

    observer = new PaymentObserver(createMock<MonitoringService>(), repos);
  });

  it('counts stuckFiatOutputs across all three independent conditions, OR-ed together', async () => {
    const data = await observer['getPayment']();

    expect(repos.fiatOutput.countBy).toHaveBeenCalledWith([
      { isReadyDate: LessThan(expect.any(Date)), isTransmittedDate: IsNull(), isComplete: false },
      {
        frickOrderStatus: In([
          FrickPaymentState.REJECTED,
          FrickPaymentState.EXPIRED,
          FrickPaymentState.DELETED,
          FrickPaymentState.ERROR,
        ]),
        isComplete: false,
      },
      { frickCustomId: Not(IsNull()), isTransmittedDate: LessThan(expect.any(Date)), isComplete: false },
    ]);
    expect(data.stuckFiatOutputs).toBe(0);
  });

  it('surfaces a Frick-terminal-but-incomplete row even though it was already transmitted', async () => {
    jest.spyOn(repos.fiatOutput, 'countBy').mockImplementation(async (where) => {
      const clauses = Array.isArray(where) ? where : [where];
      // Only the second (Frick-terminal) clause matches this synthetic row
      return clauses.some((clause: never) => 'frickOrderStatus' in (clause as object)) ? 1 : 0;
    });

    const data = await observer['getPayment']();

    expect(data.stuckFiatOutputs).toBe(1);
  });

  it('does NOT count a non-Frick row that was merely transmitted >48h ago and is still incomplete (clause 3 must not fire on cross-bank noise)', async () => {
    const nonFrickStaleRow = {
      frickCustomId: null,
      frickOrderStatus: null,
      isReadyDate: null,
      isTransmittedDate: new Date(Date.now() - 50 * 60 * 60 * 1000),
      isComplete: false,
    };
    jest
      .spyOn(repos.fiatOutput, 'countBy')
      .mockImplementation(async (where) => countMatching(where as never, [nonFrickStaleRow]));

    const data = await observer['getPayment']();

    expect(data.stuckFiatOutputs).toBe(0);
  });

  it('counts a Frick row transmitted >48h ago and still incomplete', async () => {
    const frickStaleRow = {
      frickCustomId: 'DFX-FO-1',
      frickOrderStatus: null,
      isReadyDate: null,
      isTransmittedDate: new Date(Date.now() - 50 * 60 * 60 * 1000),
      isComplete: false,
    };
    jest
      .spyOn(repos.fiatOutput, 'countBy')
      .mockImplementation(async (where) => countMatching(where as never, [frickStaleRow]));

    const data = await observer['getPayment']();

    expect(data.stuckFiatOutputs).toBe(1);
  });
});
