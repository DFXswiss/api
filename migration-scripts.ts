import { MigrationInterface, QueryRunner } from 'typeorm';

export class RealUnitRegistrationMigration implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table(
        'realunit_registration',
        [
          new Column('id', 'integer', { isPrimary: true }),
          new Column('userDataId', 'integer'),
          new Column('walletAddress', 'string'),
          new Column('status', 'string'),
        ],
      ),
    );

    await queryRunner.createForeignKey(
      'realunit_registration',
      new TableForeignKey({
        columnNames: ['userDataId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'user',
        onDelete: 'CASCADE',
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('realunit_registration', 'userDataId');
    await queryRunner.dropTable('realunit_registration');
  }
}