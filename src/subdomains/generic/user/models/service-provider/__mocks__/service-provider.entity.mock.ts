import { ServiceProvider } from '../service-provider.entity';

export function createDefaultServiceProvider(): ServiceProvider {
  return createCustomServiceProvider({});
}

export function createCustomServiceProvider(customValues: Partial<ServiceProvider>): ServiceProvider {
  const { masterKey } = customValues;
  const keys = Object.keys(customValues);

  const entity = new ServiceProvider();

  entity.masterKey = keys.includes('masterKey') ? masterKey : 'x0ZZZYYY';

  return entity;
}
