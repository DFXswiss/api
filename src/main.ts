import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as morgan from 'morgan';
import * as cors from 'cors';
import * as appInsights from 'applicationinsights';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionFilter } from './shared/filters/exception.filter';
import { json, text } from 'express';
import { KycChangedWebhookDto, KycFailedWebhookDto } from './subdomains/generic/user/services/webhook/dto/kyc-webhook.dto';
import { PaymentWebhookDto } from './subdomains/generic/user/services/webhook/dto/payment-webhook.dto';

async function bootstrap() {
  if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    appInsights.setup().setAutoDependencyCorrelation(true).setAutoCollectConsole(true, true);
    appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = 'dfx-api';
    appInsights.start();
  }

  const app = await NestFactory.create(AppModule);

  app.use(morgan('dev'));
  app.use(helmet());
  app.use(cors());

  app.use('*', json({ type: 'application/json', limit: '10mb' }));
  app.use('/v1/node/*/rpc', text({ type: 'text/plain' }));

  app.setGlobalPrefix('v1', { exclude: ['', 'app'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionFilter());

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

  console.log(`Server listening on: ${await app.getUrl()}`);
}

void bootstrap();
