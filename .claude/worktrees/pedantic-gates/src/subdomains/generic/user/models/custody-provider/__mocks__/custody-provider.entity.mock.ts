import { CustodyProvider } from '../custody-provider.entity';

export function createDefaultCustodyProvider(): CustodyProvider {
  return createCustomCustodyProvider({});
}

export function createCustomCustodyProvider(customValues: Partial<CustodyProvider>): CustodyProvider {
  const { masterKey } = customValues;
  const keys = Object.keys(customValues);

  const entity = new CustodyProvider();

  entity.masterKey = keys.includes('masterKey') ? masterKey : 'x0ZZZYYY';

  return entity;
}
