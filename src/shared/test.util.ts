import { Provider } from '@nestjs/common';
import { ConfigService, Configuration } from 'src/config/config';
import { DeepPartial } from 'typeorm';

export class TestUtil {
  static provideConfig(config: DeepPartial<Configuration> = {}): Provider {
    const conf = { ...new Configuration(), ...config } as Configuration;
    return { provide: ConfigService, useValue: new ConfigService(conf) };
  }
}
