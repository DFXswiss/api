import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxOrderStepAdapter } from '../adapter/dfx-order-step.adapter';
import { OrderConfig } from '../config/order-config';

import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CustodyOrderStatus, CustodyOrderStepContext, CustodyOrderStepStatus } from '../enums/custody';
import { CustodyOrderStepRepository } from '../repositories/custody-order-step.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';
import { CustodyOrderService } from './custody-order.service';

@Injectable()
export class CustodyJobService {
  constructor(
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly custodyOrderStepRepo: CustodyOrderStepRepository,
    private readonly dfxOrderStepAdapter: DfxOrderStepAdapter,
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
      relations: { order: { sell: true, swap: true } },
    });

    for (const step of newSteps) {
      switch (step.context) {
        case CustodyOrderStepContext.DFX:
          await this.custodyOrderStepRepo.update(...step.progress(await this.dfxOrderStepAdapter.execute(step)));
          break;
      }
    }
  }

  private async checkStep() {
    const runningSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.IN_PROGRESS },
    });

    for (const step of runningSteps) {
      switch (step.context) {
        case CustodyOrderStepContext.DFX:
          if (await this.dfxOrderStepAdapter.isComplete(step)) {
            await this.custodyOrderStepRepo.update(...step.complete());
            await this.custodyOrderService.startNextStep(step);
          }
          break;
      }
    }
  }
}
