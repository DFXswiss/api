import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { GenericModule } from './generic/generic.module';
import { SupportingModule } from './supporting/supporting.module';

@Module({
  imports: [CoreModule, GenericModule, SupportingModule],
  controllers: [],
  providers: [],
  exports: [CoreModule],
})
export class SubdomainsModule {}
