import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { LessThan } from 'typeorm';
import { DfxOrderStepAdapter } from '../adapter/dfx-order-step.adapter';
import { EquityOrderStepAdapter } from '../adapter/equity-order-step.adapter';
import { OrderConfig } from '../config/order-config';

import { Config } from 'src/config/config';
import { TransactionRevertedException } from 'src/integration/blockchain/shared/exceptions/transaction-reverted.exception';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';
import {
  CustodyOrderStatus,
  CustodyOrderStepCommand,
  CustodyOrderStepContext,
  CustodyOrderStepStatus,
} from '../enums/custody';
import { CustodyOrderStepRepository } from '../repositories/custody-order-step.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';
import { CustodyOrderService } from './custody-order.service';

interface OrderStepAdapter {
  execute(step: CustodyOrderStep): Promise<string>;
  isComplete(step: CustodyOrderStep): Promise<boolean>;
}

@Injectable()
export class CustodyJobService {
  private readonly logger = new DfxLogger(CustodyJobService);

  constructor(
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly custodyOrderStepRepo: CustodyOrderStepRepository,
    private readonly dfxOrderStepAdapter: DfxOrderStepAdapter,
    private readonly equityOrderStepAdapter: EquityOrderStepAdapter,
    private readonly custodyOrderService: CustodyOrderService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.CUSTODY })
  async handleOrders() {
    await this.executeOrder();
    await this.executeStep();
    await this.checkStep();
  }

  @DfxCron(CronExpression.EVERY_DAY_AT_4AM, { scope: CronScope.WORKER, process: Process.CUSTODY })
  async resetExpiredConfirmedOrders() {
    const expiryDate = Util.daysBefore(Config.txRequestWaitingExpiryDays);

    const expiredOrders = await this.custodyOrderRepo.find({
      where: {
        status: CustodyOrderStatus.CONFIRMED,
        updated: LessThan(expiryDate),
      },
    });

    for (const order of expiredOrders) {
      await this.custodyOrderRepo.update(...order.reset());
    }
  }

  private async executeOrder() {
    const approvedOrders = await this.custodyOrderRepo.find({
      where: { status: CustodyOrderStatus.APPROVED },
    });

    for (const order of approvedOrders) {
      try {
        const steps = OrderConfig[order.type];
        if (steps.length) {
          const index = 0;
          await this.custodyOrderService.createStep(order, index, steps[index].command, steps[index].context);
          await this.custodyOrderRepo.update(...order.progress());
        }
      } catch (e) {
        this.logger.error(`Failed to start custody order ${order.id}:`, e);
      }
    }
  }

  private async executeStep() {
    const newSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.CREATED },
      relations: { order: { sell: { deposit: true }, swap: { deposit: true }, user: true } },
    });

    for (const step of newSteps) {
      const adapter = this.getAdapter(step.context);
      if (!adapter) continue;

      try {
        await this.custodyOrderStepRepo.update(...step.progress(await adapter.execute(step)));
      } catch (e) {
        await this.onStepError(step, e, 'dispatching');
      }
    }
  }

  private async checkStep() {
    const runningSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.IN_PROGRESS },
    });

    for (const step of runningSteps) {
      const adapter = this.getAdapter(step.context);
      if (!adapter) continue;

      try {
        if (step.correlationId === 'NA' || (await adapter.isComplete(step))) {
          await this.onStepComplete(step);
        }
      } catch (e) {
        await this.onStepError(step, e, 'checking');
      }
    }
  }

  /**
   * Decides whether a step is beyond saving, and keeps one step's failure to that step.
   *
   * Every loop above now isolates its own item — `executeOrder` per order, the other two per step —
   * and none of them used to: a single throw aborted the whole cron run, so one order with a
   * reverted transaction stopped every other order from progressing for as long as it stayed there,
   * which was forever, per the paragraph below. Only the two step loops route here; a failure in
   * `executeOrder` has no step to close out and is logged where it happens.
   *
   * A REVERT is final. The chain has decided, re-running the check cannot change the answer, and
   * without a terminal state the step is re-read every minute for the lifetime of the process while
   * the customer's order sits at `Processing`. `CustodyOrderStepStatus.FAILED` existed for exactly
   * this and was assigned nowhere, so the state was unreachable. Both the step and the order are
   * now closed out, which is what puts `Failed` in front of the customer instead of a status that
   * never moves.
   *
   * Anything ELSE is not evidence about the transaction at all — an RPC timeout, a gateway error, a
   * dropped connection. Those are logged and left alone, so the next tick retries. Marking them
   * failed would be the more damaging mistake in both directions: it abandons a step that may have
   * succeeded, and it is irreversible from the job's side.
   */
  private async onStepError(step: CustodyOrderStep, error: unknown, phase: 'dispatching' | 'checking'): Promise<void> {
    const cause = error instanceof Error ? error : new Error(String(error));

    if (!(error instanceof TransactionRevertedException)) {
      this.logger.error(`Error ${phase} custody order step ${step.id}:`, cause);
      return;
    }

    this.logger.error(`Custody order step ${step.id} failed on-chain while ${phase}:`, cause);

    // Guarded, because this runs INSIDE the catch that provides the per-step isolation. A throw
    // here — a lost connection on the write, or `step.order` absent because someone dropped the
    // eager relation the step entity declares — would escape the loop and abort the whole cycle,
    // which is the failure this method exists to prevent. Leaving the step InProgress is the
    // recoverable outcome: the next tick reads it again and reports the same revert.
    try {
      await this.custodyOrderStepRepo.update(...step.fail());
      await this.custodyOrderRepo.update(...step.order.fail());
    } catch (e) {
      this.logger.error(`Could not close out failed custody order step ${step.id}:`, e);
    }
  }

  private async onStepComplete(step: CustodyOrderStep) {
    const isFinalEquityStep = [CustodyOrderStepCommand.MINT, CustodyOrderStepCommand.REDEEM].includes(step.command);

    if (isFinalEquityStep) {
      // load relations
      step.order = await this.custodyOrderRepo.findOne({
        where: { id: step.order.id },
        relations: { user: true },
      });

      const outputAmount = await this.equityOrderStepAdapter.getOutputAmount(step);

      await this.custodyOrderService.updateCustodyOrderInternal(step.order, {
        status: CustodyOrderStatus.COMPLETED,
        inputAmount: outputAmount,
      });
    }

    await this.custodyOrderStepRepo.update(...step.complete());
    await this.custodyOrderService.startNextStep(step);
  }

  private getAdapter(context: CustodyOrderStepContext): OrderStepAdapter | undefined {
    switch (context) {
      case CustodyOrderStepContext.DFX:
        return this.dfxOrderStepAdapter;
      case CustodyOrderStepContext.EQUITY:
        return this.equityOrderStepAdapter;
    }
  }
}
