import { getMetadataArgsStorage } from 'typeorm';
import { FiatRepublicEndUser } from 'src/integration/bank/entities/fiat-republic-end-user.entity';
import { FiatRepublicPayee } from 'src/integration/bank/entities/fiat-republic-payee.entity';
import { FiatOutput } from '../fiat-output.entity';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Migration = require('../../../../../migration/1786200000000-AddFiatRepublicIntegration');

function columnsOf(target: unknown, properties: string[]): Record<string, unknown> {
  return Object.fromEntries(
    getMetadataArgsStorage()
      .columns.filter((column) => column.target === target && properties.includes(column.propertyName))
      .map((column) => [column.propertyName, { length: column.options.length, nullable: column.options.nullable }]),
  );
}

async function runUp(): Promise<string> {
  const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
  await new Migration().up(queryRunner);
  return queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
}

async function runDown(): Promise<string> {
  const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
  await new Migration().down(queryRunner);
  return queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
}

describe('FiatOutput Fiat Republic column metadata', () => {
  it('keeps every tracking column aligned with the migration length', () => {
    expect(
      columnsOf(FiatOutput, [
        'fiatRepublicCustomId',
        'fiatRepublicPaymentId',
        'fiatRepublicPaymentStatus',
        'fiatRepublicError',
        'fiatRepublicReference',
        'fiatRepublicMatchLevel',
      ]),
    ).toEqual({
      fiatRepublicCustomId: { length: 256, nullable: true },
      fiatRepublicPaymentId: { length: 256, nullable: true },
      fiatRepublicPaymentStatus: { length: 256, nullable: true },
      fiatRepublicError: { length: 256, nullable: true },
      fiatRepublicReference: { length: 256, nullable: true },
      fiatRepublicMatchLevel: { length: 256, nullable: true },
    });
  });
});

describe('Fiat Republic claim table metadata', () => {
  it('matches the end user table the migration creates', () => {
    expect(columnsOf(FiatRepublicEndUser, ['endUserId', 'state', 'error'])).toEqual({
      endUserId: { length: 256, nullable: true },
      state: { length: 256, nullable: undefined },
      error: { length: 256, nullable: true },
    });
  });

  it('matches the payee table the migration creates', () => {
    expect(columnsOf(FiatRepublicPayee, ['endUserId', 'iban', 'name', 'payeeId', 'status'])).toEqual({
      endUserId: { length: 256, nullable: undefined },
      iban: { length: 256, nullable: undefined },
      name: { length: 256, nullable: undefined },
      payeeId: { length: 256, nullable: true },
      status: { length: 256, nullable: true },
    });
  });
});

describe('AddFiatRepublicIntegration migration', () => {
  it('creates both claim tables with their unique indexes', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "fiat_republic_end_user"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "fiatRepublicEndUserUserData" ON "fiat_republic_end_user" ("userDataId")',
    );
    expect(sql).toContain('CREATE TABLE "fiat_republic_payee"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "fiatRepublicPayeeIdentity" ON "fiat_republic_payee" ("endUserId", "iban", "name")',
    );
  });

  it('defaults a fresh end user claim to Pending', async () => {
    expect(await runUp()).toContain(`"state" character varying(256) NOT NULL DEFAULT 'Pending'`);
  });

  it('adds every payout tracking column to fiat_output', async () => {
    const sql = await runUp();

    for (const column of [
      'fiatRepublicCustomId',
      'fiatRepublicPaymentId',
      'fiatRepublicPaymentStatus',
      'fiatRepublicError',
      'fiatRepublicReference',
      'fiatRepublicMatchLevel',
    ]) {
      expect(sql).toContain(`ALTER TABLE "fiat_output" ADD "${column}" character varying(256)`);
    }
  });

  it('never touches bank rows — registering the collection IBAN is an operational step', async () => {
    const sql = (await runUp()).toLowerCase();

    expect(sql).not.toContain('insert into "bank"');
    expect(sql).not.toContain('update "bank"');
    expect(sql).not.toContain('delete from "bank"');
  });

  it('is purely additive — it drops nothing on the way up', async () => {
    const sql = (await runUp()).toLowerCase();

    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('drop column');
  });

  it('rolls every change back', async () => {
    const sql = await runDown();

    expect(sql).toContain('DROP TABLE "fiat_republic_end_user"');
    expect(sql).toContain('DROP TABLE "fiat_republic_payee"');
    expect(sql).toContain('DROP INDEX "public"."fiatRepublicEndUserUserData"');
    expect(sql).toContain('DROP INDEX "public"."fiatRepublicPayeeIdentity"');
    for (const column of [
      'fiatRepublicCustomId',
      'fiatRepublicPaymentId',
      'fiatRepublicPaymentStatus',
      'fiatRepublicError',
      'fiatRepublicReference',
      'fiatRepublicMatchLevel',
    ]) {
      expect(sql).toContain(`ALTER TABLE "fiat_output" DROP COLUMN "${column}"`);
    }
  });
});
