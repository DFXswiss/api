import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxOrderStepAdapter } from '../adapter/dfx-order-step.adapter';
import { OrderConfig } from '../config/order-config';

import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CustodyOrderStatus, CustodyOrderStepContext, CustodyOrderStepStatus } from '../enums/custody';
import { CustodyOrderStepRepository } from '../repositories/custody-order-step.repository';
import { CustodyOrderRepository } from '../repositories/custody-order.repository';
import { CustodyService } from './custody.service';

@Injectable()
export class CustodyJobService {
  constructor(
    private readonly custodyOrderRepo: CustodyOrderRepository,
    private readonly custodyOrderStepRepo: CustodyOrderStepRepository,
    private readonly dfxOrderStepAdapter: DfxOrderStepAdapter,
    private readonly custodyService: CustodyService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.CUSTODY })
  async executeOrder() {
    const approvedOrders = await this.custodyOrderRepo.find({
      where: { status: CustodyOrderStatus.APPROVED },
    });

    for (const order of approvedOrders) {
      const steps = OrderConfig[order.type];
      if (steps.length) {
        const index = 0;
        await this.custodyService.createStep(order, index, steps[index].command, steps[index].context);
        await this.custodyOrderRepo.update(...order.progress());
      }
    }
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.CUSTODY })
  async checkOrder() {
    const newSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.CREATED },
    });

    for (const step of newSteps) {
      switch (step.context) {
        case CustodyOrderStepContext.DFX:
          await this.custodyOrderStepRepo.update(...step.progress(await this.dfxOrderStepAdapter.execute(step)));
          break;
      }
    }

    const runningSteps = await this.custodyOrderStepRepo.find({
      where: { status: CustodyOrderStepStatus.IN_PROGRESS },
    });

    for (const step of runningSteps) {
      switch (step.context) {
        case CustodyOrderStepContext.DFX:
          if (await this.dfxOrderStepAdapter.isComplete(step)) {
            await this.custodyOrderStepRepo.update(...step.complete());
            await this.custodyService.startNextStep(step);
          }
          break;
      }
    }
  }
}
