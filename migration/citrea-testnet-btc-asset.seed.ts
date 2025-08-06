import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed CitreaTestnet BTC Asset with same PriceRule as Bitcoin
 * 
 * This migration adds BTC support on CitreaTestnet using the exact same
 * price rule as the native Bitcoin asset, ensuring price consistency.
 */
export class CitreaTestnetBtcAssetSeed implements MigrationInterface {
  name = 'CitreaTestnetBtcAssetSeed1234567890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find existing Bitcoin asset and its price rule
    const bitcoinAsset = await queryRunner.query(`
      SELECT priceRuleId 
      FROM asset 
      WHERE blockchain = 'Bitcoin' 
        AND name = 'Bitcoin' 
        AND type = 'COIN'
    `);

    if (!bitcoinAsset || bitcoinAsset.length === 0) {
      throw new Error('Bitcoin asset not found. Please ensure Bitcoin is configured first.');
    }

    const bitcoinPriceRuleId = bitcoinAsset[0].priceRuleId;

    // Check if CitreaTestnet BTC already exists
    const existingAsset = await queryRunner.query(`
      SELECT id 
      FROM asset 
      WHERE blockchain = 'CitreaTestnet' 
        AND symbol = 'BTC'
    `);

    if (existingAsset && existingAsset.length > 0) {
      console.log('CitreaTestnet BTC asset already exists, skipping...');
      return;
    }

    // Insert CitreaTestnet BTC with same price rule as Bitcoin
    await queryRunner.query(`
      INSERT INTO asset (
        blockchain,
        type,
        name,
        symbol,
        uniqueName,
        chainId,
        decimals,
        buyable,
        sellable,
        cardBuyable,
        cardSellable,
        instantBuyable,
        instantSellable,
        priceRuleId,
        created,
        updated
      ) VALUES (
        'CitreaTestnet',
        'TOKEN',
        'Bitcoin',
        'BTC',
        'CitreaTestnet/BTC',
        '0x0000000000000000000000000000000000000000', -- TODO: Replace with actual wrapped BTC contract address
        18,
        1,
        1,
        0,
        0,
        0,
        0,
        ${bitcoinPriceRuleId},
        GETDATE(),
        GETDATE()
      )
    `);

    console.log('Successfully added CitreaTestnet BTC asset with Bitcoin price rule');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove CitreaTestnet BTC asset
    await queryRunner.query(`
      DELETE FROM asset 
      WHERE blockchain = 'CitreaTestnet' 
        AND symbol = 'BTC'
    `);
  }
}

/**
 * Alternative approach using TypeORM repository pattern
 */
export async function seedCitreaTestnetBTC(assetRepository: any, priceRuleRepository: any): Promise<void> {
  // Find Bitcoin and its price rule
  const bitcoin = await assetRepository.findOne({
    where: { 
      blockchain: 'Bitcoin',
      name: 'Bitcoin',
      type: 'COIN'
    },
    relations: ['priceRule']
  });

  if (!bitcoin || !bitcoin.priceRule) {
    throw new Error('Bitcoin or its price rule not found');
  }

  // Check if CitreaTestnet BTC already exists
  const existingAsset = await assetRepository.findOne({
    where: {
      blockchain: 'CitreaTestnet',
      symbol: 'BTC'
    }
  });

  if (existingAsset) {
    console.log('CitreaTestnet BTC already exists');
    return;
  }

  // Create CitreaTestnet BTC with same price rule
  const citreaTestnetBTC = assetRepository.create({
    blockchain: 'CitreaTestnet',
    type: 'TOKEN', // Wrapped BTC on CitreaTestnet
    name: 'Bitcoin',
    symbol: 'BTC',
    uniqueName: 'CitreaTestnet/BTC',
    chainId: '0x...', // TODO: Add actual wrapped BTC contract address
    decimals: 18, // TODO: Verify actual decimals
    buyable: true,
    sellable: true,
    cardBuyable: false,
    cardSellable: false,
    instantBuyable: false,
    instantSellable: false,
    priceRule: bitcoin.priceRule, // USE SAME PRICE RULE AS BITCOIN
  });

  await assetRepository.save(citreaTestnetBTC);
  console.log('Successfully created CitreaTestnet BTC with Bitcoin price rule');
}