import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { LessThan } from 'typeorm';
import { DfxOrderStepAdapter } from '../adapter/dfx-order-step.adapter';
import { EquityOrderStepAdapter } from '../adapter/equity-order-step.adapter';
import { OrderConfig } from '../config/order-config';

import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
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

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.CUSTODY })
  async handleOrders() {
    await this.executeOrder();
    await this.executeStep();
    await this.checkStep();
  }

  @DfxCron(CronExpression.EVERY_DAY_AT_4AM, { process: Process.CUSTODY })
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
      relations: {
        order: {
          sell: { deposit: true },
          swap: { deposit: true },
          user: true,
          outputAsset: true,
          inputAsset: true,
          transactionRequest: true,
        },
      },
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
      relations: { order: { outputAsset: true, inputAsset: true } },
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
