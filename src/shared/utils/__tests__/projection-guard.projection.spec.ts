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

  it('throws on a relation it joins but selects nothing from', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    // `FIELDS` names no `language.*`, so the join exists for filtering alone. The relation is then
    // undefined on the row for every account, and code checking it takes the absent branch — which
    // reads exactly like an account that genuinely has no language.
    const row = await load(FIELDS, seeded.id);

    expect(() => row.language).toThrow(
      "read of 'UserData.language', a relation this query joins but selects nothing from",
    );
  }, 120000);

  it('leaves a relation the query does not join alone, eager or not', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const bare = new ReadProjection<UserData>('userData', [], ['userData.id']);
    const row = await bare
      .apply(dataSource.getRepository(UserData).createQueryBuilder('userData'), bare.fields)
      .where('userData.id = :id', { id: seeded.id })
      .getOne();
    const guarded = guardProjection(dataSource, UserData, bare, bare.fields, row);

    // Whether an undeclared relation should have been joined depends on what the replaced query
    // loaded, which this entity's metadata does not record — `language` is eager and `kycSteps` is
    // not, and neither fact settles it, because a `find` can switch eager loading off and name its
    // relations instead. Level 4 compares the two answers where that is observable; here both are
    // simply passed through.
    expect(guarded.language).toBeUndefined();
    expect(guarded.kycSteps).toBeUndefined();
  }, 120000);

  it('hands out the same guarded relation on every read', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const fields = [...FIELDS, 'language.id'];
    const row = await load(fields, seeded.id);

    // A fresh proxy per access would make this false, and production code comparing relations by
    // identity — or using one as a map key — would behave differently under the guard than without
    // it. The guard has to be invisible except where it throws.
    expect(row.language).toBe(row.language);

    // It also carries the caller's assignments across reads: with a new proxy each time, each one
    // starts with an empty set of them and reading back what was just written throws.
    row.language.symbol = 'assigned-by-the-caller';
    expect(row.language.symbol).toEqual('assigned-by-the-caller');
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

  it('leaves a @RelationId alone when the query did fill it', async () => {
    // Guarded on the value, not on the declaration: the throw is for the silent `undefined`, and a
    // value that did arrive is not a defect whatever filled it.
    const leg = guardProjection(
      dataSource,
      LedgerLeg,
      new ReadProjection<LedgerLeg>('leg', [], ['leg.id']),
      ['leg.id'],
      { id: 1, txId: 7 } as LedgerLeg,
    );

    expect(leg.txId).toEqual(7);
  }, 120000);

  it('lets an embedded column be read back after the caller assigned it', async () => {
    const projection = new ReadProjection<CryptoInput>('input', [], ['input.id']);
    const input = guardProjection(dataSource, CryptoInput, projection, projection.fields, {
      id: 1,
      address: {},
    } as unknown as CryptoInput);

    input.address.address = 'written-by-the-caller';

    // Without the write being recorded this throws, because the query never selected the column.
    expect(input.address.address).toEqual('written-by-the-caller');
  }, 120000);

  it.each(['getMany', 'getOneOrFail'] as const)(
    'guards the rows of %s',
    async (method) => {
      const language = await seedEntity<Language>(dataSource, Language);
      const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

      const query = PROJECTION.apply(dataSource.getRepository(UserData).createQueryBuilder('userData'), FIELDS).where(
        'userData.id = :id',
        { id: seeded.id },
      );
      const rows = await query[method]();
      const row = Array.isArray(rows) ? rows[0] : rows;

      expect(() => row.surname).toThrow("read of 'UserData.surname'");
    },
    120000,
  );

  it('guards the entities of getRawAndEntities and leaves the raw rows untouched', async () => {
    const language = await seedEntity<Language>(dataSource, Language);
    const seeded = await seedEntity<UserData>(dataSource, UserData, { values: { language } });

    const { entities, raw } = await PROJECTION.apply(
      dataSource.getRepository(UserData).createQueryBuilder('userData'),
      FIELDS,
    )
      .where('userData.id = :id', { id: seeded.id })
      .getRawAndEntities();

    expect(() => entities[0].surname).toThrow("read of 'UserData.surname'");
    // The raw half is what the caller asked the database for, not an entity — reading it is not a
    // projection question and the guard must not touch it.
    expect(raw).toHaveLength(1);
    expect(Object.keys(raw[0]).length).toBeGreaterThan(0);
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
