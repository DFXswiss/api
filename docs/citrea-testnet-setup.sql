-- CitreaTestnet BTC Asset Setup
-- ================================
-- This script sets up BTC on CitreaTestnet with the same price rule as Bitcoin

-- Step 1: Find the existing Bitcoin asset and its price rule
-- Note: This assumes Bitcoin already exists in your database
DECLARE @BitcoinPriceRuleId INT;
SELECT @BitcoinPriceRuleId = priceRuleId 
FROM asset 
WHERE blockchain = 'Bitcoin' 
  AND name = 'Bitcoin' 
  AND type = 'COIN';

-- Step 2: Insert BTC on CitreaTestnet (as wrapped token)
-- Using the SAME price rule as Bitcoin
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
    priceRuleId
) VALUES (
    'CitreaTestnet',      -- blockchain
    'TOKEN',              -- type (wrapped BTC on CitreaTestnet)
    'Bitcoin',            -- name
    'BTC',                -- symbol
    'CitreaTestnet/BTC',  -- uniqueName
    '0x...',              -- chainId (contract address of wrapped BTC on CitreaTestnet)
    18,                   -- decimals (adjust based on actual token)
    1,                    -- buyable
    1,                    -- sellable
    0,                    -- cardBuyable
    0,                    -- cardSellable
    0,                    -- instantBuyable
    0,                    -- instantSellable
    @BitcoinPriceRuleId   -- SAME price rule as Bitcoin!
);

-- Alternative: If you want native currency on CitreaTestnet
-- (unlikely for BTC, but shown for completeness)
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
    priceRuleId
) VALUES (
    'CitreaTestnet',      -- blockchain
    'COIN',               -- type (native coin)
    'CitreaBTC',          -- name
    'cBTC',               -- symbol
    'CitreaTestnet/cBTC', -- uniqueName
    NULL,                 -- chainId (NULL for native coin)
    18,                   -- decimals
    1,                    -- buyable
    1,                    -- sellable
    @BitcoinPriceRuleId   -- SAME price rule as Bitcoin!
);

-- Step 3: Verify the setup
SELECT 
    a.id,
    a.blockchain,
    a.type,
    a.name,
    a.symbol,
    a.uniqueName,
    a.priceRuleId,
    pr.priceSource,
    pr.priceAsset,
    pr.priceReference,
    pr.currentPrice
FROM asset a
JOIN price_rule pr ON a.priceRuleId = pr.id
WHERE a.blockchain IN ('Bitcoin', 'CitreaTestnet')
  AND a.name LIKE '%Bitcoin%'
ORDER BY a.blockchain;