import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as AppInsights from 'applicationinsights';
import { useContainer } from 'class-validator';
import { spawn } from 'child_process';
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

async function bootstrap() {
  if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    AppInsights.setup().setAutoDependencyCorrelation(true).setAutoCollectConsole(true, true);
    AppInsights.defaultClient.context.tags[AppInsights.defaultClient.context.keys.cloudRole] = 'dfx-api';
    AppInsights.start();
  }

  const app = await NestFactory.create(AppModule);

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

  await app.listen(Config.port);

  new DfxLogger('Main').info(`Application ready ...`);

  // Run seed after app starts in LOC environment (tables must exist first)
  if (Config.environment === Environment.LOC) {
    runSeed();
  }
}

function runSeed(): void {
  const logger = new DfxLogger('Seed');
  // Use process.cwd() instead of __dirname because __dirname points to dist/src when compiled
  const seedPath = join(process.cwd(), 'migration', 'seed', 'seed.js');

  logger.info('Running database seed...');

  const seedProcess = spawn('node', [seedPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  seedProcess.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => line && logger.verbose(line));
  });

  seedProcess.stderr.on('data', (data: Buffer) => {
    logger.error(data.toString().trim());
  });

  seedProcess.on('close', (code) => {
    if (code === 0) {
      logger.info('Database seed completed');
    } else {
      logger.error(`Database seed failed with code ${code}`);
    }
  });
}

void bootstrap();
