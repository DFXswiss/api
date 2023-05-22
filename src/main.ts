import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import * as AppInsights from 'applicationinsights';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from './shared/filters/exception.filter';
import { json, text } from 'express';
import {
  KycChangedWebhookDto,
  KycFailedWebhookDto,
} from './subdomains/generic/user/services/webhook/dto/kyc-webhook.dto';
import { PaymentWebhookDto } from './subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { DfxLogger } from './shared/services/dfx-logger';

async function bootstrap() {
  if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    AppInsights.setup().setAutoDependencyCorrelation(true).setAutoCollectConsole(true, true);
    AppInsights.defaultClient.context.tags[AppInsights.defaultClient.context.keys.cloudRole] = 'dfx-api';
    AppInsights.start();
  }

  const app = await NestFactory.create(AppModule);

  app.use(morgan('dev'));
  app.use(helmet());
  app.use(cors());

  app.use('*', json({ type: 'application/json', limit: '10mb' }));
  app.use('/v1/node/*/rpc', text({ type: 'text/plain' }));

  app.setGlobalPrefix('v1', { exclude: [''] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new ApiExceptionFilter());

  const swaggerOptions = new DocumentBuilder()
    .setTitle('DFX API')
    .setDescription(`DFX API (updated on ${new Date().toLocaleString()})`)
    .setVersion('v1')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerOptions, {
    extraModels: [KycChangedWebhookDto, KycFailedWebhookDto, PaymentWebhookDto],
  });
  SwaggerModule.setup('/swagger', app, swaggerDocument);

  await app.listen(process.env.PORT || 3000);

  new DfxLogger('Main').info(`Application ready ...`);
}

void bootstrap();
