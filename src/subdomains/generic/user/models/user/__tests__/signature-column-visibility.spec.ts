import { Column, DataSource, Entity, getMetadataArgsStorage, PrimaryGeneratedColumn, QueryRunner } from 'typeorm';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'signature_column_visibility_spec';

describe('User signature column metadata', () => {
  it('marks signature with select: false so TypeORM excludes it from default queries', () => {
    const column = getMetadataArgsStorage().columns.find((c) => c.target === User && c.propertyName === 'signature');

    expect(column).toBeDefined();
    expect(column.options.select).toBe(false);
  });

  it('does not mark address with select: false (control for metadata reading)', () => {
    const column = getMetadataArgsStorage().columns.find((c) => c.target === User && c.propertyName === 'address');

    expect(column).toBeDefined();
    expect(column.options.select).toBeUndefined();
  });
});

// Minimal probe entity: `hidden` mirrors User.signature column options
// (`type: 'text', nullable: true, select: false`) so this block exercises the
// ORM mechanism UserService.getSignature() relies on — not the User entity itself
// (too many relations for an isolated DataSource).
@Entity({ name: 'select_false_probe' })
class SelectFalseProbe {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  visible: string;

  @Column({ type: 'text', nullable: true, select: false })
  hidden?: string;
}

describeDb('select: false runtime behaviour (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: PG_URL,
      entities: [SelectFalseProbe],
      schema: SCHEMA,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    await queryRunner.query(`
      CREATE TABLE "select_false_probe" (
        "id" SERIAL PRIMARY KEY,
        "visible" text NOT NULL,
        "hidden" text
      )
    `);
  });

  afterEach(async () => {
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('findOne omits a select: false column from the loaded entity', async () => {
    const inserted = (await queryRunner.query(
      `INSERT INTO "select_false_probe" ("visible", "hidden")
       VALUES ('visible-value', 'hidden-secret')
       RETURNING "id"`,
    )) as { id: number }[];
    const id = inserted[0].id;

    const row = await dataSource.getRepository(SelectFalseProbe).findOne({ where: { id } });

    expect(row).toBeDefined();
    expect(row.visible).toBe('visible-value');
    expect(row.hidden).toBeUndefined();
  });

  it('addSelect returns a select: false column ' + '(the pattern UserService.getSignature() uses)', async () => {
    const inserted = (await queryRunner.query(
      `INSERT INTO "select_false_probe" ("visible", "hidden")
         VALUES ('visible-value', 'hidden-secret')
         RETURNING "id"`,
    )) as { id: number }[];
    const id = inserted[0].id;

    const row = await dataSource
      .getRepository(SelectFalseProbe)
      .createQueryBuilder('probe')
      .select('probe.id')
      .addSelect('probe.hidden')
      .where('probe.id = :id', { id })
      .getOne();

    expect(row).toBeDefined();
    expect(row.hidden).toBe('hidden-secret');
  });

  it('raw SQL still sees the value (select: false is ORM-level, not a data migration)', async () => {
    const inserted = (await queryRunner.query(
      `INSERT INTO "select_false_probe" ("visible", "hidden")
       VALUES ('visible-value', 'hidden-secret')
       RETURNING "id"`,
    )) as { id: number }[];
    const id = inserted[0].id;

    const rows = (await queryRunner.query(`SELECT "hidden" FROM "select_false_probe" WHERE "id" = $1`, [id])) as {
      hidden: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].hidden).toBe('hidden-secret');
  });
});
