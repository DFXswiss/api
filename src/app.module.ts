import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { GetConfig } from './config/config';
import { IntegrationModule } from './integration/integration.module';
import { TfaEnforcementInterceptor } from './shared/auth/tfa-enforcement.interceptor';
import { SharedModule } from './shared/shared.module';
import { SubdomainsModule } from './subdomains/subdomains.module';

@Module({
  imports: [TypeOrmModule.forRoot(GetConfig().database), SharedModule, IntegrationModule, SubdomainsModule],
  controllers: [AppController],
  // Global backstop enforcing STRICT app-2FA on every route for a mail-origin staff session (tfaRequired).
  // Only needs ModuleRef + Reflector (both globally available), so no extra module imports are required.
  providers: [{ provide: APP_INTERCEPTOR, useClass: TfaEnforcementInterceptor }],
  exports: [],
})
export class AppModule {}
