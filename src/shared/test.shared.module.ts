import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt', session: true })],
  controllers: [],
  providers: [],
  exports: [PassportModule],
})
export class TestSharedModule {}
