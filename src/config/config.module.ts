import { Module } from '@nestjs/common';
import { ConfigService } from 'src/config/config.service';
import { ConfigModule as ConfigurationModule } from '@nestjs/config';

@Module({
  imports: [ConfigurationModule.forRoot()],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}

export const getConfig = (selector: (config: ConfigService) => any) => ({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: selector,
});
