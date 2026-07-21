import { IMemoryTable, newDb } from 'pg-mem';

type CountryRow = {
  symbol: string;
  dfxEnable: boolean;
  dfxOrganizationEnable: boolean;
  fatfEnable: boolean;
  updated: Date;
};

let EnablePhilippinesOnboarding: new () => {
  up(queryRunner: { query(sql: string): Promise<unknown[]> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<unknown[]> }): Promise<void>;
};

describe('EnablePhilippinesOnboarding migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<unknown[]>, [string]>;
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

    // many() executes the statement and returns result rows ([] for UPDATE), so the migration's
    // existence SELECT sees real data while UPDATEs still run.
    query = jest.fn(async (sql: string) => db.public.many(sql));
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
    // Each up() runs an existence SELECT plus the guarded UPDATE → 2 statements per invocation.
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('does not rewrite an already enabled PH row', async () => {
    insertCountry('PH', true);

    await migration.up({ query });

    expect(getCountry('PH')).toMatchObject({
      dfxEnable: true,
      updated: new Date('2024-01-01T00:00:00.000Z'),
    });
  });

  it('fails loud instead of silently no-op when the PH row is missing', async () => {
    insertCountry('CH', true, true, true);

    await expect(migration.up({ query })).rejects.toThrow(/PH.*not found/);

    // Unrelated countries are left untouched by the aborted migration.
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
