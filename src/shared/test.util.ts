import { Provider } from '@nestjs/common';
import { ConfigService, Configuration } from 'src/config/config';
import { DeepPartial } from 'typeorm';

export class TestUtil {
  static provideConfig(config: DeepPartial<Configuration>): Provider {
    return { provide: ConfigService, useValue: new ConfigService(config as Configuration) };
  }
}
