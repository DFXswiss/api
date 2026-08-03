// Must be imported first: starts the OpenTelemetry SDK before any instrumented
// library is loaded (see src/tracing.ts). The polyfills import (which pulls in
// the `eventsource` package and ultimately Node's `http`) follows so its
// internal HTTP usage is auto-instrumented.
import './tracing';
import './runtime-metrics'; // event loop saturation gauges; must follow ./tracing (needs its meter provider)
import './polyfills'; // registers global EventSource for @arkade-os/sdk; see src/polyfills.ts
import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { spawnSync } from 'child_process';
import { useContainer } from 'class-validator';
import cors from 'cors';
import { json, raw, text, Request } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { join } from 'path';
import { getVerifiedIp } from './shared/utils/ip.util';
import { AppModule } from './app.module';
import { Config, Environment } from './config/config';
import { ApiExceptionFilter } from './shared/filters/exception.filter';
import { apiTraceMiddleware, maskUrl } from './shared/middlewares/api-trace.middleware';
import { DetailedValidationPipe } from './shared/pipes/detailed-validation.pipe';
import { CronLeaseService } from './shared/services/cron-lease.service';
import { DfxLogger } from './shared/services/dfx-logger';
import { AccountChangedWebhookDto } from './subdomains/generic/user/services/webhook/dto/account-changed-webhook.dto';
import {
  KycChangedWebhookDto,
  KycFailedWebhookDto,
} from './subdomains/generic/user/services/webhook/dto/kyc-webhook.dto';
import { PaymentWebhookDto } from './subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { PricingService } from './subdomains/supporting/pricing/services/pricing.service';

process.on('uncaughtException', (error) => {
  const logger = new DfxLogger('UncaughtException');

  const isSparkError =
    error?.constructor?.name?.includes('Spark') || error?.message?.includes('Channel has been shut down');

  if (isSparkError) {
    logger.error('Spark SDK uncaught exception (process kept alive):', error);
    return;
  }

  logger.error('Uncaught exception, shutting down:', error);
  process.exit(1);
});

async function bootstrap() {
  // Observability is initialized in src/tracing.ts (imported above): the
  // OpenTelemetry SDK auto-instruments HTTP/DB/NestJS and exports traces via
  // OTLP. 4xx-not-a-failure is handled there in the HTTP response hook.

  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // morgan's default :url logs the raw query string and unmasked wallet
  // addresses to the same stdout the log pipeline ships — mask it like the
  // trace middleware does.
  morgan.token('url', (req) => maskUrl((req as Request).originalUrl ?? req.url ?? ''));
  app.use(morgan('dev'));
  app.use(helmet());
  app.use(
    cors({
      exposedHeaders: ['content-disposition'],
    }),
  );

  app.use((req, _res, next) => {
    req.realIp = getVerifiedIp(req);
    next();
  });

  app.use('/v2/kyc/ident/sumsub', raw({ type: 'application/json', limit: '10mb' }));
  app.use('/v1/alchemy/addressWebhook', raw({ type: 'application/json', limit: '10mb' }));
  app.use('/v1/tatum/addressWebhook', raw({ type: 'application/json', limit: '10mb' }));
  app.use('*', json({ type: 'application/json', limit: '20mb' }));
  app.use('/v1/node/*/rpc', text({ type: 'text/plain' }));

  // Full request/response tracing for the RealUnit internal test phase (DEV + PRD)
  if ([Environment.DEV, Environment.PRD].includes(Config.environment)) {
    app.use(apiTraceMiddleware());
  }

  releaseCronLeasesOnShutdown(app);

  app.useWebSocketAdapter(new WsAdapter(app));

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [Config.defaultVersion],
  });
  app.useGlobalPipes(
    // Same validation and same 400 body as the stock ValidationPipe; it additionally carries the
    // rejected values through to the exception filter's log line.
    new DetailedValidationPipe({
      whitelist: true,
      transformOptions: {
        exposeUnsetFields: false,
      },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  const swaggerOptions = new DocumentBuilder()
    .setTitle('DFX API')
    .setDescription(
      `DFX API ${Config.environment.toUpperCase()} (updated on ${new Date().toLocaleString()})\n\n` +
        '**Amount Convention:** All amount fields use human-readable display units (e.g., 1.5 BTC, not 150,000,000 satoshis). ',
    )
    .setExternalDoc('Github documentation', Config.social.github)
    .setVersion(Config.defaultVersionString)
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerOptions, {
    extraModels: [KycChangedWebhookDto, KycFailedWebhookDto, AccountChangedWebhookDto, PaymentWebhookDto],
  });
  SwaggerModule.setup('/swagger', app, swaggerDocument);

  // Run seed BEFORE listen in LOC environment (tables exist after NestFactory.create)
  if (Config.environment === Environment.LOC) {
    runSeed();

    // Re-initialize PricingService fiatMap after seeding (was empty during onModuleInit)
    const pricingService = app.get(PricingService);
    await pricingService.onModuleInit();
  }

  await app.listen(Config.port);

  new DfxLogger('Main').info(`Application ready ...`);
}

/**
 * Gives the cron leases a chance to be handed over before a deployment takes the process away.
 *
 * Nothing in this application ever asked for a shutdown hook, so SIGTERM used to end the process
 * instantly: a job running at that moment never reached the release in its `finally`, and its row
 * in `cron_lease` sat there until it expired. That is what CronLeaseService.shutdown addresses.
 *
 * Deliberately a signal handler rather than `app.enableShutdownHooks()`. That switch is global and
 * would, for the first time, start running the nine `onModuleDestroy` hooks this application
 * carries — Nest runs them BEFORE the hook above, and they empty the strategy registries that
 * PayIn, PayOut and DEX jobs resolve from. Since the whole point of the wait is to keep in-flight
 * jobs alive longer into the shutdown, the two together would let a running payout fail on an
 * emptied registry rather than simply be cut off. Handing a lease over is not worth that.
 *
 * Registering a handler means Node no longer terminates on the signal by itself, so this has to
 * exit. `CronLeaseService.shutdown` is bounded by its own grace period, and a second signal takes
 * the impatient path — otherwise a stuck shutdown would hold the container until SIGKILL.
 *
 * It also means the process outlives the signal, which is new. Everything that was true only
 * because the process ended immediately has to be re-established explicitly — starting with not
 * accepting further requests; see the listener close below.
 */
function releaseCronLeasesOnShutdown(app: INestApplication): void {
  const logger = new DfxLogger('Shutdown');
  const leases = app.get(CronLeaseService);

  let started = false;

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (started) {
        logger.warn(`Second ${signal}, exiting without waiting for the running jobs`);
        process.exit(1);
      }

      started = true;
      logger.info(`${signal} received, releasing the cron leases`);

      // Stop taking NEW connections first. Waiting for the running jobs keeps this process alive
      // for up to the grace period, and without this it would go on accepting requests for that
      // whole span and then cut them off mid-flight at the `process.exit` below — a window that
      // did not exist while the signal ended the process at once.
      //
      // The listener only, NOT `app.close()`: that is the call which runs the nine
      // `onModuleDestroy` hooks described above, and it would empty the strategy registries out
      // from under the jobs this wait exists to protect. Not awaited either — a keep-alive
      // connection can hold the callback back indefinitely, and the bound here is the grace
      // period, not the client.
      app.getHttpServer().close();

      void leases
        .shutdown()
        .catch((e) => logger.error('Failed to release the cron leases on shutdown:', e))
        .finally(() => process.exit(0));
    });
  }
}

function runSeed(): void {
  const logger = new DfxLogger('Seed');
  const seedPath = join(process.cwd(), 'migration', 'seed', 'seed.js');

  logger.info('Running database seed...');

  // Run synchronously to ensure data exists before API accepts requests
  const result = spawnSync('node', [seedPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  if (result.stdout) {
    const lines = result.stdout.toString().trim().split('\n');
    lines.forEach((line) => line && logger.verbose(line));
  }

  if (result.stderr && result.stderr.length > 0) {
    logger.error(result.stderr.toString().trim());
  }

  if (result.status === 0) {
    logger.info('Database seed completed');
  } else {
    logger.error(`Database seed failed with code ${result.status}`);
  }
}

void bootstrap();
