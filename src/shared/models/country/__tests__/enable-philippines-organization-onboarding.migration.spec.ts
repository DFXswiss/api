import { IMemoryTable, newDb } from 'pg-mem';

type CountryRow = {
  symbol: string;
  dfxEnable: boolean;
  dfxOrganizationEnable: boolean;
  fatfEnable: boolean;
  updated: Date;
};

let EnablePhilippinesOrganizationOnboarding: new () => {
  up(queryRunner: { query(sql: string): Promise<unknown[]> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<unknown[]> }): Promise<void>;
};

describe('EnablePhilippinesOrganizationOnboarding migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<unknown[]>, [string]>;
  let migration: InstanceType<typeof EnablePhilippinesOrganizationOnboarding>;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    EnablePhilippinesOrganizationOnboarding = require('../../../../../migration/1784708401563-EnablePhilippinesOrganizationOnboarding');
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
    migration = new EnablePhilippinesOrganizationOnboarding();
  });

  const insertCountry = (symbol: string, dfxOrganizationEnable: boolean, dfxEnable = true, fatfEnable = true): void => {
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

  it('enables only organization onboarding for PH, leaving individual onboarding untouched, and is idempotent', async () => {
    // PH already has individual onboarding on (from #4206) but organization onboarding off.
    insertCountry('PH', false, true);
    insertCountry('CH', true, true, false);

    await migration.up({ query });

    const enabled = getCountry('PH');
    expect(enabled).toMatchObject({
      symbol: 'PH',
      dfxOrganizationEnable: true,
      dfxEnable: true,
      fatfEnable: true,
    });
    expect(enabled.updated).not.toEqual(new Date('2024-01-01T00:00:00.000Z'));
    expect(getCountry('CH')).toMatchObject({
      dfxOrganizationEnable: true,
      dfxEnable: true,
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
      dfxOrganizationEnable: true,
      updated: new Date('2024-01-01T00:00:00.000Z'),
    });
  });

  it('fails loud instead of silently no-op when the PH row is missing', async () => {
    insertCountry('CH', true);

    await expect(migration.up({ query })).rejects.toThrow(/PH.*not found/);

    // Unrelated countries are left untouched by the aborted migration.
    expect(getCountryTable().find()).toEqual([getCountry('CH')]);
  });

  it('does not silently reintroduce the restriction during rollback', async () => {
    insertCountry('PH', false);
    await migration.up({ query });
    query.mockClear();

    await migration.down({ query });

    expect(getCountry('PH').dfxOrganizationEnable).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
