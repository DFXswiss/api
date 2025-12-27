import { DynamicModule, Module, Provider } from '@nestjs/common';
import { Environment, GetConfig } from 'src/config/config';
import { MockHttpService } from './services/mock-http.service';
import { MockStorageService } from './services/mock-storage.service';
import { MockMailService } from './services/mock-mail.service';
import { MockAlchemyService } from './services/mock-alchemy.service';
import { HttpService } from 'src/shared/services/http.service';

@Module({})
export class MockModule {
  static forRoot(): DynamicModule {
    const isLocal = GetConfig().environment === Environment.LOC;

    if (!isLocal) {
      return { module: MockModule };
    }

    console.log('🔶 MockModule: Loading mock services for local development');

    const mockProviders: Provider[] = [
      MockHttpService,
      MockStorageService,
      MockMailService,
      MockAlchemyService,
    ];

    return {
      module: MockModule,
      providers: mockProviders,
      exports: mockProviders,
      global: true,
    };
  }
}
