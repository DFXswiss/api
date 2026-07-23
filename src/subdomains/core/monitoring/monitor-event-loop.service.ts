import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { monitorEventLoopDelay } from 'perf_hooks';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';

@Injectable()
export class MonitorEventLoopService {
  private readonly logger = new DfxLogger(MonitorEventLoopService);

  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });

  constructor() {
    this.histogram.enable();
  }

  @DfxCron(CronExpression.EVERY_10_SECONDS, { process: Process.MONITOR_EVENT_LOOP })
  monitorEventLoop(): void {
    const toMs = (ns: number) => Math.round(ns / 1e6);

    this.logger.info(
      `EventLoop delay: mean ${toMs(this.histogram.mean)}ms / p95 ${toMs(
        this.histogram.percentile(95),
      )}ms / max ${toMs(this.histogram.max)}ms`,
    );

    this.histogram.reset();
  }
}
