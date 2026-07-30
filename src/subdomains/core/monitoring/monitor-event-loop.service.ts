import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';

@Injectable()
export class MonitorEventLoopService implements OnModuleDestroy {
  private readonly logger = new DfxLogger(MonitorEventLoopService);

  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });

  private lastElu = performance.eventLoopUtilization();

  constructor() {
    this.histogram.enable();
  }

  // Disable the histogram so its sampling timer does not continue after module teardown.
  onModuleDestroy(): void {
    this.histogram.disable();
  }

  @DfxCron(CronExpression.EVERY_10_SECONDS, { process: Process.MONITOR_EVENT_LOOP })
  monitorEventLoop(): void {
    const toMs = (ns: number) => Math.round(ns / 1e6);

    const current = performance.eventLoopUtilization();
    const elu = performance.eventLoopUtilization(current, this.lastElu);
    this.lastElu = current;

    this.logger.info(
      `EventLoop delay: mean ${toMs(this.histogram.mean)}ms / p95 ${toMs(
        this.histogram.percentile(95),
      )}ms / max ${toMs(this.histogram.max)}ms / utilization ${(elu.utilization * 100).toFixed(1)}%`,
    );

    this.histogram.reset();
  }
}
