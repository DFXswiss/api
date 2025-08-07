import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed CitreaTestnet cBTC Native Coin Asset with same PriceRule as Bitcoin
 * 
 * IMPORTANT: cBTC is the NATIVE COIN on CitreaTestnet (like ETH on Ethereum),
 * NOT an ERC20 token. It uses the same price as Bitcoin since it represents
 * wrapped Bitcoin on the Citrea L2.
 * 
 * This migration adds cBTC support on CitreaTestnet using the exact same
 * price rule as the native Bitcoin asset, ensuring price consistency.
 */
export class CitreaTestnetCBtcAssetSeed implements MigrationInterface {
  name = 'CitreaTestnetCBtcAssetSeed1234567890';

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

    // Check if CitreaTestnet cBTC already exists
    const existingAsset = await queryRunner.query(`
      SELECT id 
      FROM asset 
      WHERE blockchain = 'CitreaTestnet' 
        AND symbol = 'cBTC'
    `);

    if (existingAsset && existingAsset.length > 0) {
      console.log('CitreaTestnet cBTC asset already exists, skipping...');
      return;
    }

    // Insert CitreaTestnet cBTC as NATIVE COIN with same price rule as Bitcoin
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
        'COIN',  -- NATIVE COIN, not TOKEN!
        'Citrea Bitcoin',
        'cBTC',  -- Using cBTC to clearly indicate it's Citrea's native currency
        'CitreaTestnet/cBTC',
        NULL,  -- Native coins don't have contract addresses
        18,  -- Citrea uses 18 decimals for cBTC (EVM standard)
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

    console.log('Successfully added CitreaTestnet cBTC native coin asset with Bitcoin price rule');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove CitreaTestnet cBTC asset
    await queryRunner.query(`
      DELETE FROM asset 
      WHERE blockchain = 'CitreaTestnet' 
        AND symbol = 'cBTC'
    `);
  }
}

/**
 * Alternative approach using TypeORM repository pattern
 */
export async function seedCitreaTestnetCBTC(assetRepository: any, priceRuleRepository: any): Promise<void> {
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

  // Check if CitreaTestnet cBTC already exists
  const existingAsset = await assetRepository.findOne({
    where: {
      blockchain: 'CitreaTestnet',
      symbol: 'cBTC'
    }
  });

  if (existingAsset) {
    console.log('CitreaTestnet cBTC already exists');
    return;
  }

  // Create CitreaTestnet cBTC as NATIVE COIN with same price rule
  const citreaTestnetCBTC = assetRepository.create({
    blockchain: 'CitreaTestnet',
    type: 'COIN',  // NATIVE COIN on CitreaTestnet
    name: 'Citrea Bitcoin',
    symbol: 'cBTC',
    uniqueName: 'CitreaTestnet/cBTC',
    chainId: null,  // Native coins don't have contract addresses
    decimals: 18,  // Citrea uses 18 decimals for cBTC (EVM standard)
    buyable: true,
    sellable: true,
    cardBuyable: false,
    cardSellable: false,
    instantBuyable: false,
    instantSellable: false,
    priceRule: bitcoin.priceRule,  // USE SAME PRICE RULE AS BITCOIN
  });

  await assetRepository.save(citreaTestnetCBTC);
  console.log('Successfully created CitreaTestnet cBTC native coin with Bitcoin price rule');
}