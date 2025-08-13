import { MigrationInterface, QueryRunner } from 'typeorm';

export class CitreaTestnetCbtcAsset1754950663000 implements MigrationInterface {
  name = 'CitreaTestnetCbtcAsset1754950663000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert cBTC as native COIN asset for CitreaTestnet
    await queryRunner.query(`
      INSERT INTO asset (
        name,
        symbol,
        blockchain,
        type,
        decimals,
        chainId,
        sellable,
        buyable,
        isActive,
        created,
        updated
      )
      SELECT 
        'cBTC' as name,
        'cBTC' as symbol,
        'CitreaTestnet' as blockchain,
        'COIN' as type,
        18 as decimals,
        NULL as chainId, -- Native coins don't have a contract address
        1 as sellable,
        1 as buyable,
        1 as isActive,
        GETDATE() as created,
        GETDATE() as updated
      WHERE NOT EXISTS (
        SELECT 1 FROM asset 
        WHERE name = 'cBTC' 
        AND blockchain = 'CitreaTestnet' 
        AND type = 'COIN'
      )
    `);

    // Link to Bitcoin price rule for pricing
    await queryRunner.query(`
      UPDATE asset
      SET priceRuleId = (SELECT id FROM asset WHERE name = 'BTC' AND blockchain = 'Bitcoin' AND type = 'COIN')
      WHERE name = 'cBTC' 
      AND blockchain = 'CitreaTestnet' 
      AND type = 'COIN'
      AND priceRuleId IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM asset 
      WHERE name = 'cBTC' 
      AND blockchain = 'CitreaTestnet' 
      AND type = 'COIN'
    `);
  }
}