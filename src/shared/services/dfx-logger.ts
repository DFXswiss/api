import { Logger } from '@nestjs/common';
import { isSpanContextValid, SpanStatusCode, trace } from '@opentelemetry/api';

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
    this.recordOnSpan(message, error, true);
    this.logger.error(this.format(message, error));
  }

  error(message: string, error?: Error) {
    this.recordOnSpan(message, error, true);
    this.logger.error(this.format(message, error));
  }

  warn(message: string, error?: Error) {
    this.recordOnSpan(message, error, false);
    this.logger.warn(this.format(message, error));
  }

  info(message: string, error?: Error) {
    this.logger.log(this.format(message, error));
  }

  verbose(message: string, error?: Error) {
    this.logger.verbose(this.format(message, error));
  }

  // --- HELPER METHODS --- //

  // Attach the log to the active trace span so warnings/errors surface on the
  // request's trace and exceptions are correlated to it — the OpenTelemetry
  // equivalent of App Insights' exception/trace tracking. No-op when there is
  // no active span (background jobs, startup).
  private recordOnSpan(message: string, error: Error | undefined, isError: boolean) {
    const span = trace.getActiveSpan();
    if (!span) return;

    if (error) {
      span.recordException(error);
    } else {
      span.addEvent(message);
    }

    if (isError) span.setStatus({ code: SpanStatusCode.ERROR, message });
  }

  private format(message: string, error?: Error): string {
    return message + (error ? ` ${error?.stack}` : '') + this.traceContext();
  }

  // Append the active trace id so Grafana can link a Loki log line straight to
  // its Tempo trace (the Loki data source matches `trace_id=<hex>`).
  private traceContext(): string {
    const span = trace.getActiveSpan();
    if (!span) return '';

    const ctx = span.spanContext();
    return isSpanContextValid(ctx) ? ` trace_id=${ctx.traceId} span_id=${ctx.spanId}` : '';
  }
}
