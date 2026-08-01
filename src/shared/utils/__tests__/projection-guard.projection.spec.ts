import { ReadProjection } from 'src/shared/models/read-projection';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  guardProjection,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { Country } from 'src/shared/models/country/country.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { LedgerLeg } from 'src/subdomains/core/accounting/entities/ledger-leg.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { DataSource } from 'typeorm';

const SCHEMA = 'projection_guard_spec';

/**
 * The guard itself, tested against a real query.
 *
 * Everything else in this suite relies on it: it is what turns a silently missing column into a
 * failure, and it is therefore the one piece that cannot be verified by the levels it protects.
 */
describeProjection('guardProjection', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  const FIELDS = ['userData.id', 'userData.mail', 'userData.firstname'];
  const PROJECTION = new ReadProjection<UserData>('userData', [['userData.language', 'language']], FIELDS);

  async function load(fields: ReadonlyArray<string>, id: number): Promise<UserData> {
    const row = await PROJECTION.apply(dataSource.getRepository(UserData).createQueryBuilder('userData'), fields)
      .where('userData.id = :id', { id })
      .getOne();

    return guardProjection(dataSource, UserData, PROJECTION, fields, row);
  }

  it('passes through a column the query selected', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const row = await load(FIELDS, seeded.id);

    expect(row.mail).toEqual(seeded.mail);
    expect(row.firstname).toEqual(seeded.firstname);
  }, 120000);

  it('throws on a column the query did not select, naming it', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const row = await load(FIELDS, seeded.id);

    // Without the guard this reads `undefined` and every getter downstream computes with it.
    expect(() => row.surname).toThrow("read of 'UserData.surname', which this query did not select");
  }, 120000);

  it('reports the column a getter reaches through, not the getter', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    // `completeName` is `organizationName ?? firstname + surname`. The getter has to keep running —
    // it is how the missing column is reached — and the failure has to name the column.
    const row = await load(FIELDS, seeded.id);

    expect(() => row.completeName).toThrow('UserData.organizationName');
  }, 120000);

  it('guards a joined relation in turn', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const fields = [...FIELDS, 'language.id', 'language.name'];
    const row = await load(fields, seeded.id);

    expect(row.language.name).toEqual(language.name);
    // Two levels down, and reported where it is missing rather than at the relation.
    expect(() => row.language.symbol).toThrow("read of 'Language.symbol'");
  }, 120000);

  it('throws on a @RelationId, which no field list can select', async () => {
    // The property is filled from the foreign-key column of the row, which a query naming its
    // fields does not carry — the defect this suite exists to catch, in the one shape where the
    // fix is never "add it to the projection".
    const leg = guardProjection(
      dataSource,
      LedgerLeg,
      new ReadProjection<LedgerLeg>('leg', [], ['leg.id']),
      ['leg.id'],
      { id: 1 } as LedgerLeg,
    );

    expect(() => leg.txId).toThrow("read of 'LedgerLeg.txId', a @RelationId that a projected query never fills");
  }, 120000);

  it('guards a column inside an embedded object, by its full path', async () => {
    const projection = new ReadProjection<CryptoInput>('input', [], ['input.id', 'input.address.address']);
    const row = { id: 1, address: { address: 'selected', blockchain: 'hidden' } } as unknown as CryptoInput;

    const input = guardProjection(dataSource, CryptoInput, projection, projection.fields, row);

    // Selecting one column of the embedded must not mark the rest of it as selected.
    expect(input.address.address).toEqual('selected');
    expect(() => input.address.blockchain).toThrow("read of 'CryptoInput.address.blockchain'");
  }, 120000);

  it('guards the rows of getManyAndCount, which runs its own query', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const [rows] = await PROJECTION.apply(
      dataSource.getRepository(UserData).createQueryBuilder('userData'),
      FIELDS,
    ).getManyAndCount();

    expect(() => rows[0].surname).toThrow("read of 'UserData.surname'");
  }, 120000);

  it('leaves a column the query selected but the row has as null alone', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const country = await seedEntity<Country>(dataSource, Country);
    const seeded = await seedEntity<UserData>(dataSource, UserData, {
      values: { language, country, firstname: null },
    });

    // A selected column that is genuinely null is data, not a projection defect.
    const row = await load(FIELDS, seeded.id);

    expect(row.firstname).toBeNull();
  }, 120000);
});
