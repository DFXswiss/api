import { IMemoryTable, newDb } from 'pg-mem';

type CountryRow = {
  symbol: string;
  dfxEnable: boolean;
  dfxOrganizationEnable: boolean;
  fatfEnable: boolean;
  updated: Date;
};

let EnablePhilippinesOnboarding: new () => {
  up(queryRunner: { query(sql: string): Promise<void> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<void> }): Promise<void>;
};

describe('EnablePhilippinesOnboarding migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<void>, [string]>;
  let migration: InstanceType<typeof EnablePhilippinesOnboarding>;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    EnablePhilippinesOnboarding = require('../../../../../migration/1784029705806-EnablePhilippinesOnboarding');
  });

  beforeEach(() => {
    db = newDb();
    db.public.none(`
      CREATE TABLE "country" (
        "symbol" character varying(10) PRIMARY KEY,
        "dfxEnable" boolean NOT NULL,
        "dfxOrganizationEnable" boolean NOT NULL,
        "fatfEnable" boolean NOT NULL,
        "updated" TIMESTAMP NOT NULL
      )
    `);

    query = jest.fn(async (sql: string) => db.public.none(sql));
    migration = new EnablePhilippinesOnboarding();
  });

  const insertCountry = (
    symbol: string,
    dfxEnable: boolean,
    dfxOrganizationEnable = false,
    fatfEnable = true,
  ): void => {
    getCountryTable().insert({
      symbol,
      dfxEnable,
      dfxOrganizationEnable,
      fatfEnable,
      updated: new Date('2024-01-01T00:00:00.000Z'),
    });
  };

  const getCountryTable = () => db.public.getTable('country') as IMemoryTable<CountryRow>;

  const getCountry = (symbol: string): CountryRow => getCountryTable().find({ symbol })[0];

  it('enables only individual DFX onboarding for PH and is idempotent', async () => {
    insertCountry('PH', false);
    insertCountry('CH', false, true, false);

    await migration.up({ query });

    const enabled = getCountry('PH');
    expect(enabled).toMatchObject({
      symbol: 'PH',
      dfxEnable: true,
      dfxOrganizationEnable: false,
      fatfEnable: true,
    });
    expect(enabled.updated).not.toEqual(new Date('2024-01-01T00:00:00.000Z'));
    expect(getCountry('CH')).toMatchObject({
      dfxEnable: false,
      dfxOrganizationEnable: true,
      fatfEnable: false,
      updated: new Date('2024-01-01T00:00:00.000Z'),
    });

    await migration.up({ query });

    expect(getCountry('PH')).toEqual(enabled);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not rewrite an already enabled PH row', async () => {
    insertCountry('PH', true);

    await migration.up({ query });

    expect(getCountry('PH')).toMatchObject({
      dfxEnable: true,
      updated: new Date('2024-01-01T00:00:00.000Z'),
    });
  });

  it('is a safe no-op when the PH row does not exist yet', async () => {
    insertCountry('CH', true, true, true);

    await expect(migration.up({ query })).resolves.toBeUndefined();

    expect(getCountryTable().find()).toEqual([getCountry('CH')]);
  });

  it('does not silently reintroduce the restriction during rollback', async () => {
    insertCountry('PH', false);
    await migration.up({ query });
    query.mockClear();

    await migration.down({ query });

    expect(getCountry('PH').dfxEnable).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
