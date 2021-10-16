import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as helmet from 'helmet';
import * as morgan from 'morgan';
import * as cors from 'cors';
import * as chalk from 'chalk';
import * as appInsights from 'applicationinsights';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionFilter } from './shared/filters/exception.filter';
import { json, text } from 'express';

async function bootstrap() {
  if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    appInsights.setup()
      .setAutoDependencyCorrelation(true)
      .setAutoCollectConsole(true, true);
    appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = 'dfx-api';
    appInsights.start();
  }

  const app = await NestFactory.create(AppModule);

  app.use(morgan('dev'));
  app.use(helmet());
  app.use(cors());

  app.use('*', json({type: 'application/json'}));
  app.use('/v1/node/*/rpc', text({type: 'text/plain'}));

  app.setGlobalPrefix('v1', { exclude: [''] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionFilter());

  const swaggerOptions = new DocumentBuilder()
    .setTitle('DFX-API')
    .setDescription('Investiere in jedes DeFiChain Asset mit EUR, CHF & USD via Banküberweisung')
    .setVersion('v0.2')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerOptions);
  SwaggerModule.setup('/api', app, swaggerDocument);

  const config = app.get(ConfigService);

  await app.listen(process.env.PORT || 3000);

  console.log(chalk.blue.inverse(`Server listening on: ${await app.getUrl()} on ${config.get('mode')} mode`));
}

bootstrap();
