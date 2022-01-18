import { Module } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { ConfigModule as ConfigurationModule } from '@nestjs/config';

@Module({
  imports: [ConfigurationModule.forRoot()],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
