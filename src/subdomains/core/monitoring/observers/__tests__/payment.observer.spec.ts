import { createMock } from '@golevelup/ts-jest';
import { FrickPaymentState } from 'src/integration/bank/dto/frick.dto';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { MonitoringService } from 'src/subdomains/core/monitoring/monitoring.service';
import { IsNull, LessThan, In } from 'typeorm';
import { PaymentObserver } from '../payment.observer';

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
      { isTransmittedDate: LessThan(expect.any(Date)), isComplete: false },
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

  it('surfaces a generically stuck (transmitted >48h, still incomplete) row regardless of bank', async () => {
    jest.spyOn(repos.fiatOutput, 'countBy').mockImplementation(async (where) => {
      const clauses = Array.isArray(where) ? where : [where];
      return clauses.some(
        (clause: never) => 'isTransmittedDate' in (clause as object) && !('isReadyDate' in (clause as object)),
      )
        ? 1
        : 0;
    });

    const data = await observer['getPayment']();

    expect(data.stuckFiatOutputs).toBe(1);
  });
});
