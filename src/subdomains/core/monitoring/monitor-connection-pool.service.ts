import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConnectionPool } from 'mssql/lib/tedious/connection-pool';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { DataSource } from 'typeorm';
import { SqlServerConnectionOptions } from 'typeorm/driver/sqlserver/SqlServerConnectionOptions';
import { SqlServerDriver } from 'typeorm/driver/sqlserver/SqlServerDriver';

@Injectable()
export class MonitorConnectionPoolService {
  private readonly logger = new DfxLogger(MonitorConnectionPoolService);

  private readonly dbConnectionPool: ConnectionPool;

  constructor(dataSource: DataSource) {
    const dbDriver = dataSource.driver as SqlServerDriver;
    this.dbConnectionPool = dbDriver.master;
  }

  @Cron(CronExpression.EVERY_SECOND)
  @Lock()
  monitorConnectionPool() {
    if (DisabledProcess(Process.MONITOR_CONNECTION_POOL)) return;

    const dbOptions = Config.database as SqlServerConnectionOptions;
    const dbMaxPoolConnections = dbOptions.pool.max;

    if (
      dbMaxPoolConnections === this.dbConnectionPool.size &&
      dbMaxPoolConnections === this.dbConnectionPool.borrowed
    ) {
      // Warning, if there are all connections in use
      this.logger.warn(
        `ConnectionPool with max. borrowed connections: S${this.dbConnectionPool.size}/A${this.dbConnectionPool.available}/P${this.dbConnectionPool.pending}/B${this.dbConnectionPool.borrowed}`,
      );
    } else if (this.dbConnectionPool.pending > 0) {
      // Info, if there is a pending connection
      this.logger.info(
        `ConnectionPool with pending connections: S${this.dbConnectionPool.size}/A${this.dbConnectionPool.available}/P${this.dbConnectionPool.pending}/B${this.dbConnectionPool.borrowed}`,
      );
    }
  }
}
