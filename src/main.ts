import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as helmet from 'helmet';
import * as morgan from 'morgan';
import * as cors from 'cors';
import * as chalk from 'chalk';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(morgan('dev'));
  app.use(helmet());
  app.use(cors());
  app.setGlobalPrefix('v1');

  const swaggerOptions = new DocumentBuilder()
    .setTitle('DFX-API')
    .setDescription('Investiere in jedes DeFiChain Asset mit EUR, CHF & USD via Banküberweisung')
    .setVersion('0.1')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerOptions);
  SwaggerModule.setup('/api', app, swaggerDocument);

  const config = app.get(ConfigService);

  await app.listen(3000);

  console.log(
    chalk.blue.inverse(
      `Server listening on: ${await app.getUrl()} on ${config.get(
        'mode',
      )} mode`,
    ),
  );
}

bootstrap();
