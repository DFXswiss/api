import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as AppInsights from 'applicationinsights';
import { useContainer } from 'class-validator';
import { spawnSync } from 'child_process';
import cors from 'cors';
import { json, raw, text } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { join } from 'path';
import { AppModule } from './app.module';
import { Config, Environment } from './config/config';
import { ApiExceptionFilter } from './shared/filters/exception.filter';
import { DfxLogger } from './shared/services/dfx-logger';
import { AccountChangedWebhookDto } from './subdomains/generic/user/services/webhook/dto/account-changed-webhook.dto';
import {
  KycChangedWebhookDto,
  KycFailedWebhookDto,
} from './subdomains/generic/user/services/webhook/dto/kyc-webhook.dto';
import { PaymentWebhookDto } from './subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { PricingService } from './subdomains/supporting/pricing/services/pricing.service';

async function bootstrap() {
  if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    AppInsights.setup().setAutoDependencyCorrelation(true).setAutoCollectConsole(true, true);
    AppInsights.defaultClient.context.tags[AppInsights.defaultClient.context.keys.cloudRole] = 'dfx-api';

    // Don't mark 4xx client errors as failures - only 5xx are real server errors
    AppInsights.defaultClient.addTelemetryProcessor((envelope) => {
      const data = envelope.data as { baseType?: string; baseData?: { responseCode?: string; success?: boolean } };
      if (data.baseType === 'RequestData' && data.baseData?.responseCode) {
        const responseCode = parseInt(data.baseData.responseCode, 10);
        if (responseCode >= 400 && responseCode < 500) {
          data.baseData.success = true;
        }
      }
      return true;
    });

    AppInsights.start();
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(morgan('dev'));
  app.use(helmet());
  app.use(
    cors({
      exposedHeaders: ['content-disposition'],
    }),
  );

  app.use('/v2/kyc/ident/sumsub', raw({ type: 'application/json', limit: '10mb' }));
  app.use('/v1/alchemy/addressWebhook', raw({ type: 'application/json', limit: '10mb' }));
  app.use('/v1/tatum/addressWebhook', raw({ type: 'application/json', limit: '10mb' }));
  app.use('*', json({ type: 'application/json', limit: '20mb' }));
  app.use('/v1/node/*/rpc', text({ type: 'text/plain' }));

  app.useWebSocketAdapter(new WsAdapter(app));

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [Config.defaultVersion],
  });
  app.useGlobalPipes(
    new ValidationPipe({
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
    .setDescription(`DFX API ${Config.environment.toUpperCase()} (updated on ${new Date().toLocaleString()})`)
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
