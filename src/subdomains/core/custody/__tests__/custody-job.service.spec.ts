import { createMock } from '@golevelup/ts-jest';
import { TransactionRevertedException } from 'src/integration/blockchain/shared/exceptions/transaction-reverted.exception';
import { DfxOrderStepAdapter } from 'src/subdomains/core/custody/adapter/dfx-order-step.adapter';
import { EquityOrderStepAdapter } from 'src/subdomains/core/custody/adapter/equity-order-step.adapter';
import { CustodyOrderStep } from 'src/subdomains/core/custody/entities/custody-order-step.entity';
import { CustodyOrder } from 'src/subdomains/core/custody/entities/custody-order.entity';
import {
  CustodyOrderStepCommand,
  CustodyOrderStepContext,
  CustodyOrderStepStatus,
  CustodyOrderStatus,
} from 'src/subdomains/core/custody/enums/custody';
import { CustodyOrderStepRepository } from 'src/subdomains/core/custody/repositories/custody-order-step.repository';
import { CustodyOrderRepository } from 'src/subdomains/core/custody/repositories/custody-order.repository';
import { CustodyJobService } from 'src/subdomains/core/custody/services/custody-job.service';
import { CustodyOrderService } from 'src/subdomains/core/custody/services/custody-order.service';

/**
 * What a reverted transaction does to the run it is in, and to every other run beside it.
 *
 * A custody step whose transaction reverts used to do two things, both silent: it threw out of
 * `handleOrders` and aborted the whole cron cycle, and it left its own step `InProgress` forever
 * because nothing ever assigned `FAILED`. The customer's order then sat at `Processing`
 * indefinitely. Every test here is written from that angle — not "was a method called", but "can
 * one bad step still stop the others, and does a dead step ever reach a terminal state".
 */
describe('CustodyJobService', () => {
  function buildService(adapter: Partial<DfxOrderStepAdapter>) {
    const stepRepo = createMock<CustodyOrderStepRepository>();
    const orderRepo = createMock<CustodyOrderRepository>();

    const service = new CustodyJobService(
      orderRepo,
      stepRepo,
      createMock<DfxOrderStepAdapter>(adapter),
      createMock<EquityOrderStepAdapter>(),
      createMock<CustodyOrderService>(),
    );

    return { service, stepRepo, orderRepo };
  }

  /** A step mid-flight, with the order relation `checkStep` loads. */
  function runningStep(id: number): CustodyOrderStep {
    const order = Object.assign(new CustodyOrder(), { id: id * 100, status: CustodyOrderStatus.IN_PROGRESS });
    return Object.assign(new CustodyOrderStep(), {
      id,
      order,
      status: CustodyOrderStepStatus.IN_PROGRESS,
      correlationId: `0x${id}`,
      index: 0,
      command: CustodyOrderStepCommand.REDEEM,
      context: CustodyOrderStepContext.DFX,
    });
  }

  /** The status each `update(criteria, payload)` call was asked to write. */
  const writtenStatuses = (repo: { update: jest.Mock }) => repo.update.mock.calls.map((c) => c[1]?.status);

  describe('a step whose transaction reverted', () => {
    it('closes out both the step and the order, so the customer stops seeing Processing', async () => {
      // `CustodyOrderStepStatus.FAILED` existed and was assigned nowhere, so a reverted step was
      // re-read every minute forever. `CustodyOrderStatus.FAILED` is already mapped to the
      // customer-facing history status — it just had no writer.
      const { service, stepRepo, orderRepo } = buildService({
        isComplete: jest.fn().mockRejectedValue(new TransactionRevertedException('0x1')),
      });
      stepRepo.find.mockResolvedValue([runningStep(1)]);
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['checkStep']();

      expect(writtenStatuses(stepRepo as never)).toContain(CustodyOrderStepStatus.FAILED);
      expect(writtenStatuses(orderRepo as never)).toContain(CustodyOrderStatus.FAILED);
    });

    it('does not stop the steps behind it in the same run', async () => {
      // The whole loop used to abort on the first throw, so one order with a reverted transaction
      // held up every other order for as long as it sat there — which was indefinitely.
      const isComplete = jest
        .fn()
        .mockRejectedValueOnce(new TransactionRevertedException('0x1'))
        .mockResolvedValue(false);

      const { service, stepRepo } = buildService({ isComplete });
      stepRepo.find.mockResolvedValue([runningStep(1), runningStep(2), runningStep(3)]);
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['checkStep']();

      expect(isComplete).toHaveBeenCalledTimes(3);
    });
  });

  describe('a step whose state could not be read', () => {
    it('is left alone for the next tick, not marked failed', async () => {
      // An RPC timeout says nothing about the transaction. Marking it failed would abandon a step
      // that may well have succeeded, and `FAILED` is terminal — the job never looks again.
      const { service, stepRepo, orderRepo } = buildService({
        isComplete: jest.fn().mockRejectedValue(new Error('failed to get transaction: Gateway timeout')),
      });
      stepRepo.find.mockResolvedValue([runningStep(1)]);
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['checkStep']();

      expect(writtenStatuses(stepRepo as never)).not.toContain(CustodyOrderStepStatus.FAILED);
      expect(writtenStatuses(orderRepo as never)).not.toContain(CustodyOrderStatus.FAILED);
    });

    it('still does not stop the steps behind it', async () => {
      const isComplete = jest.fn().mockRejectedValueOnce(new Error('Gateway timeout')).mockResolvedValue(false);

      const { service, stepRepo } = buildService({ isComplete });
      stepRepo.find.mockResolvedValue([runningStep(1), runningStep(2)]);
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['checkStep']();

      expect(isComplete).toHaveBeenCalledTimes(2);
    });
  });

  describe('when closing out a failed step itself fails', () => {
    it('still does not abort the run', async () => {
      // `onStepError` runs inside the catch that provides the isolation, so a throw from its own
      // writes would escape the loop and take the cycle down — the exact failure it exists to
      // prevent. Leaving the step InProgress is recoverable: the next tick sees the same revert.
      const isComplete = jest.fn().mockRejectedValue(new TransactionRevertedException('0x1'));

      const { service, stepRepo } = buildService({ isComplete });
      stepRepo.find.mockResolvedValue([runningStep(1), runningStep(2)]);
      stepRepo.update.mockRejectedValue(new Error('connection terminated'));
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await expect(service['checkStep']()).resolves.not.toThrow();
      expect(isComplete).toHaveBeenCalledTimes(2);
    });
  });

  describe('a step that could not be dispatched', () => {
    it('fails the order when the transaction reverted, and keeps going otherwise', async () => {
      // `executeStep` had the same shape: one throw from `adapter.execute` aborted the cycle before
      // the remaining new steps were dispatched at all.
      const execute = jest
        .fn()
        .mockRejectedValueOnce(new TransactionRevertedException('0x1'))
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValue('0x3');

      const { service, stepRepo, orderRepo } = buildService({ execute });
      stepRepo.find.mockResolvedValue([runningStep(1), runningStep(2), runningStep(3)]);
      jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['executeStep']();

      expect(execute).toHaveBeenCalledTimes(3);
      // Exactly one of the three reverted, so exactly one order is closed out.
      expect(writtenStatuses(orderRepo as never).filter((s) => s === CustodyOrderStatus.FAILED)).toHaveLength(1);
    });
  });
});
