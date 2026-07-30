import fs from 'node:fs';
import path from 'node:path';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

type CsvRow = Record<string, string>;

const GENERIC_PRICED_PAY_IN_BLOCKCHAINS = new Set<string>([
  Blockchain.ARBITRUM,
  Blockchain.BASE,
  Blockchain.BINANCE_SMART_CHAIN,
  Blockchain.CARDANO,
  Blockchain.CITREA,
  Blockchain.ETHEREUM,
  Blockchain.GNOSIS,
  Blockchain.INTERNET_COMPUTER,
  Blockchain.OPTIMISM,
  Blockchain.POLYGON,
  Blockchain.SEPOLIA,
  Blockchain.SOLANA,
  Blockchain.TRON,
  Blockchain.ZANO,
  Blockchain.BINANCE_PAY,
  Blockchain.KUCOIN_PAY,
]);

const ACTIVE_FLAGS = [
  'buyable',
  'sellable',
  'cardBuyable',
  'cardSellable',
  'instantBuyable',
  'instantSellable',
  'paymentEnabled',
];

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value.trim());
  return values;
}

function readCsv(fileName: string): CsvRow[] {
  const lines = fs
    .readFileSync(path.join(process.cwd(), 'migration/seed', fileName), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const headers = parseCsvLine(lines.at(0)!);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    expect(values).toHaveLength(headers.length);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function isActive(asset: CsvRow): boolean {
  return ACTIVE_FLAGS.some((flag) => asset[flag] === 'TRUE');
}

describe('asset seed pricing invariants', () => {
  const assets = readCsv('asset.csv');
  const priceRules = readCsv('price_rule.csv');
  const priceRulesById = new Map(priceRules.map((rule) => [rule.id, rule]));

  it('links ONDO to the existing local semantic price rule', () => {
    const ondo = assets.find((asset) => asset.uniqueName === 'Ethereum/ONDO');

    expect(ondo?.priceRuleId).toBe('60');
    expect(priceRulesById.get(ondo!.priceRuleId)).toMatchObject({
      priceSource: 'CoinGecko',
      priceAsset: 'ondo-finance',
      priceReference: 'tether',
    });
  });

  it('references only price-rule ids that exist in the seed', () => {
    const missingRules = assets
      .filter((asset) => asset.priceRuleId && !priceRulesById.has(asset.priceRuleId))
      .map((asset) => `${asset.uniqueName}:${asset.priceRuleId}`);

    expect(missingRules).toEqual([]);
  });

  it('prices every active seed asset handled by a generic priced pay-in strategy', () => {
    const activeUnpricedAssets = assets
      .filter(
        (asset) => GENERIC_PRICED_PAY_IN_BLOCKCHAINS.has(asset.blockchain) && isActive(asset) && !asset.priceRuleId,
      )
      .map((asset) => asset.uniqueName);

    expect(activeUnpricedAssets).toEqual([]);
  });

  it('lists only real asset.csv columns in ACTIVE_FLAGS', () => {
    const headerLine = fs
      .readFileSync(path.join(process.cwd(), 'migration/seed/asset.csv'), 'utf8')
      .split(/\r?\n/)
      .find(Boolean)!;
    const headers = new Set(parseCsvLine(headerLine));
    const phantomFlags = ACTIVE_FLAGS.filter((flag) => !headers.has(flag));

    expect(phantomFlags).toEqual([]);
  });

  it('pins the generic-priced pay-in chains that currently have no seed rows', () => {
    // The active-asset price-rule invariant is vacuously green for any chain with zero CSV rows.
    // This expected list is the known empty set: a newly emptied chain or a newly seeded one
    // must update the pin, so the gap does not go unnoticed.
    const seedBlockchains = new Set(assets.map((asset) => asset.blockchain));
    const chainsWithoutSeedRows = [...GENERIC_PRICED_PAY_IN_BLOCKCHAINS]
      .filter((chain) => !seedBlockchains.has(chain))
      .sort();

    expect(chainsWithoutSeedRows).toEqual(['Citrea', 'InternetComputer'].sort());
  });
});
