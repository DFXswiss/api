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

  private previousElu = performance.eventLoopUtilization();

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

    const currentElu = performance.eventLoopUtilization();
    // Two-arg form: one-arg then a bare call would sample two different instants and drift the reference.
    const intervalElu = performance.eventLoopUtilization(currentElu, this.previousElu);

    this.logger.info(
      `EventLoop delay: mean ${toMs(this.histogram.mean)}ms / p95 ${toMs(
        this.histogram.percentile(95),
      )}ms / max ${toMs(this.histogram.max)}ms / utilization ${(intervalElu.utilization * 100).toFixed(1)}%`,
    );

    // Both windows advance only after a successful log, so utilization and delay always
    // describe the same interval. The reset runs first: it is the only one of these two
    // steps that can realistically throw (a native call), while the plain field assignment
    // below it practically never does. If the reset throws, the ELU reference is left
    // untouched too, so the two windows stay aligned instead of drifting apart by one line.
    this.histogram.reset();
    this.previousElu = currentElu;
  }
}
