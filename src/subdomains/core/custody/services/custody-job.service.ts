import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxOrderStepAdapter } from '../adapter/dfx-order-step.adapter';
import { EquityOrderStepAdapter } from '../adapter/equity-order-step.adapter';
import { OrderConfig } from '../config/order-config';

import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
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

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.CUSTODY })
  async handleOrders() {
    await this.executeOrder();
    await this.executeStep();
    await this.checkStep();
  }

  private async executeOrder() {
    const approvedOrders = await this.custodyOrderRepo.find({
      where: { status: CustodyOrderStatus.APPROVED },
    });

    for (const order of approvedOrders) {
      const steps = OrderConfig[order.type];
      if (steps.length) {
        const index = 0;
        await this.custodyOrderService.createStep(order, index, steps[index].command, steps[index].context);
        await this.custodyOrderRepo.update(...order.progress());
      }
    }
  }

  private async executeStep() {
    const newSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.CREATED },
      relations: { order: { sell: true, swap: true, user: true } },
    });

    for (const step of newSteps) {
      const adapter = this.getAdapter(step.context);
      if (adapter) {
        await this.custodyOrderStepRepo.update(...step.progress(await adapter.execute(step)));
      }
    }
  }

  private async checkStep() {
    const runningSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.IN_PROGRESS },
      relations: { order: { user: true } },
    });

    for (const step of runningSteps) {
      const adapter = this.getAdapter(step.context);
      if (!adapter) continue;

      if (step.correlationId === 'NA' || (await adapter.isComplete(step))) {
        await this.onStepComplete(step);
      }
    }
  }

  private async onStepComplete(step: CustodyOrderStep) {
    const isFinalEquityStep =
      step.command === CustodyOrderStepCommand.MINT || step.command === CustodyOrderStepCommand.REDEEM;

    if (isFinalEquityStep) {
      try {
        const outputAmount = await this.equityOrderStepAdapter.getOutputAmount(step);

        await this.custodyOrderService.updateCustodyOrderInternal(step.order, {
          status: CustodyOrderStatus.COMPLETED,
          inputAmount: outputAmount,
        });
      } catch (e) {
        this.logger.error(`Failed to get equity output amount for step ${step.id}:`, e);
      }
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
