import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ConnectionPool } from 'mssql/lib/tedious/connection-pool';
import { Config } from 'src/config/config';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { DataSource } from 'typeorm';
import { SqlServerConnectionOptions } from 'typeorm/driver/sqlserver/SqlServerConnectionOptions';
import { SqlServerDriver } from 'typeorm/driver/sqlserver/SqlServerDriver';

@Injectable()
export class MonitorConnectionPoolService {
  private readonly dbConnectionPool: ConnectionPool;

  constructor(dataSource: DataSource, private readonly logger: DfxLoggerService) {
    const dbDriver = dataSource.driver as SqlServerDriver;
    this.dbConnectionPool = dbDriver.master;
    this.logger.create(MonitorConnectionPoolService);
  }

  @DfxCron(CronExpression.EVERY_SECOND, { process: Process.MONITOR_CONNECTION_POOL })
  monitorConnectionPool() {
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

  @DfxCron(CronExpression.EVERY_10_SECONDS, { process: Process.MONITOR_CONNECTION_POOL })
  monitorConnectionPoolStatic() {
    this.logger.info(
      `ConnectionPool connections: S${this.dbConnectionPool.size}/A${this.dbConnectionPool.available}/P${this.dbConnectionPool.pending}/B${this.dbConnectionPool.borrowed}`,
    );
  }
}
