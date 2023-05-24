import { Logger } from '@nestjs/common';
import { TelemetryClient } from 'applicationinsights';
import { SeverityLevel } from 'applicationinsights/out/Declarations/Contracts';
import * as AppInsights from 'applicationinsights';

export enum LogLevel {
  CRITICAL = 'Critical',
  ERROR = 'Error',
  WARN = 'Warn',
  INFO = 'Info',
  VERBOSE = 'Verbose',
}

export class DfxLogger {
  private readonly context?: string;
  private readonly logger: Logger;

  constructor(context?: { name: string } | string) {
    this.context = typeof context === 'string' ? context : context?.name;
    this.logger = new Logger(this.context);
  }

  log(level: LogLevel, message: string, error?: Error) {
    switch (level) {
      case LogLevel.CRITICAL:
        this.critical(message, error);
        break;

      case LogLevel.ERROR:
        this.error(message, error);
        break;

      case LogLevel.WARN:
        this.warn(message, error);
        break;

      case LogLevel.INFO:
        this.info(message, error);
        break;

      case LogLevel.VERBOSE:
        this.verbose(message, error);
        break;
    }
  }

  critical(message: string, error?: Error) {
    this.trace(SeverityLevel.Critical, message, error);
    this.logger.error(this.format(message, error));
  }

  error(message: string, error?: Error) {
    this.trace(SeverityLevel.Error, message, error);
    this.logger.error(this.format(message, error));
  }

  warn(message: string, error?: Error) {
    this.trace(SeverityLevel.Warning, message, error);
    this.logger.warn(this.format(message, error));
  }

  info(message: string, error?: Error) {
    this.trace(SeverityLevel.Information, message, error);
    this.logger.log(this.format(message, error));
  }

  verbose(message: string, error?: Error) {
    this.trace(SeverityLevel.Verbose, message, error);
    this.logger.verbose(this.format(message, error));
  }

  // --- HELPER METHODS --- //

  private trace(severity: SeverityLevel, message: string, error?: Error) {
    const trace = (this.context ? `[${this.context}] ` : '') + this.format(message, error);
    this.client?.trackTrace({ severity, message: trace });
  }

  private format(message: string, error?: Error): string {
    return message + (error ? ` ${error?.stack}` : '');
  }

  private get client(): TelemetryClient | undefined {
    return AppInsights.defaultClient;
  }
}
