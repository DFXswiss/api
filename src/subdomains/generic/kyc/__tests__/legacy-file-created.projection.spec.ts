import { KycFile } from 'src/subdomains/generic/kyc/entities/kyc-file.entity';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { DataSource } from 'typeorm';

const SCHEMA = 'legacy_file_created_spec';

/**
 * The legacy KYC file backfill dates each catalog row by the timestamp in its storage key, so a
 * document from 2019 keeps 2019 rather than the date of the run. `kyc_file.created` is a
 * `@CreateDateColumn`, and whether an explicitly set value survives the insert is a property of the
 * ORM and the driver — no mocked repository can answer it, and the consumer that picks the NEWEST
 * file of a type would turn a wrong answer into wrong compliance evidence rather than into a failure.
 *
 * Against a real database because that is the only place the question exists. TypeORM overwrites a
 * create-date only on the Mongo driver (`SubjectExecutor`), and its insert builder leaves the
 * relational path alone — this pins that, so an upgrade that changes it fails here.
 */
describeProjection('KycFile created date', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
  }, 180000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  it('stores the date the backfill set rather than the time of the insert', async () => {
    const blobDate = new Date('2019-08-13T09:10:11.000Z');

    const seeded = await seedEntity(dataSource, KycFile, {
      values: { created: blobDate, path: 'spider/1/online-identification/1565687411000/report.pdf' },
    });

    const stored = await dataSource
      .getRepository(KycFile)
      .findOne({ where: { id: seeded.id }, loadEagerRelations: false });

    expect(stored.created.toISOString()).toBe(blobDate.toISOString());
  }, 60000);

  // The fallback the backfill takes for a key that carries no timestamp: the column default stamps
  // the row, which is what every other writer of this table gets. Such a row carries no date the
  // dossier may report — `legacyDocumentDate` is what tells the two apart afterwards.
  //
  // Asserts THAT a date arrives, not which one. The column is timezone-naive and the default is the
  // database's own clock, so comparing it against this process's wall clock would measure the offset
  // between the two rather than the behaviour under test.
  it('falls back to the column default when no date is set', async () => {
    const seeded = await seedEntity(dataSource, KycFile, { values: { path: 'spider/2/user-added-document/x.pdf' } });

    const stored = await dataSource
      .getRepository(KycFile)
      .findOne({ where: { id: seeded.id }, loadEagerRelations: false });

    expect(stored.created).toBeInstanceOf(Date);
  }, 60000);
});
