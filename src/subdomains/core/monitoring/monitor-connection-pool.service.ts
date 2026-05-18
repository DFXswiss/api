import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

@Injectable()
export class MonitorConnectionPoolService {
  private readonly logger = new DfxLogger(MonitorConnectionPoolService);

  private readonly dbConnectionPool: any; // pg.Pool

  constructor(dataSource: DataSource) {
    const dbDriver = dataSource.driver as PostgresDriver;
    this.dbConnectionPool = dbDriver.master;
  }

  @DfxCron(CronExpression.EVERY_SECOND, { process: Process.MONITOR_CONNECTION_POOL })
  monitorConnectionPool() {
    const dbOptions = Config.database as PostgresConnectionOptions;
    const dbMaxPoolConnections = dbOptions.poolSize ?? 10;

    const total = this.dbConnectionPool.totalCount;
    const idle = this.dbConnectionPool.idleCount;
    const waiting = this.dbConnectionPool.waitingCount;

    if (dbMaxPoolConnections === total && idle === 0) {
      // Warning, if there are all connections in use
      this.logger.warn(`ConnectionPool with max. borrowed connections: T${total}/I${idle}/W${waiting}`);
    } else if (waiting > 0) {
      // Info, if there is a pending connection
      this.logger.info(`ConnectionPool with pending connections: T${total}/I${idle}/W${waiting}`);
    }
  }

  @DfxCron(CronExpression.EVERY_10_SECONDS, { process: Process.MONITOR_CONNECTION_POOL })
  monitorConnectionPoolStatic() {
    const total = this.dbConnectionPool.totalCount;
    const idle = this.dbConnectionPool.idleCount;
    const waiting = this.dbConnectionPool.waitingCount;

    this.logger.info(`ConnectionPool connections: T${total}/I${idle}/W${waiting}`);
  }
}
