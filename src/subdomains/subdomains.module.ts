import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { GenericModule } from './generic/generic.module';
import { LogModule } from './supporting/log/log.module';
import { SupportingModule } from './supporting/supporting.module';

@Module({
  imports: [CoreModule, GenericModule, SupportingModule, LogModule],
  controllers: [],
  providers: [],
  exports: [CoreModule],
})
export class SubdomainsModule {}
