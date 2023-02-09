import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { SharedModule } from './shared/shared.module';
import { GetConfig } from './config/config';
import { IntegrationModule } from './integration/integration.module';
import { SubdomainsModule } from './subdomains/subdomains.module';

@Module({
  imports: [TypeOrmModule.forRoot(GetConfig().database), SharedModule, IntegrationModule, SubdomainsModule],
  controllers: [AppController],
  providers: [],
  exports: [],
})
export class AppModule {}
