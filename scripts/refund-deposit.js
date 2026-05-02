#!/usr/bin/env node
/* eslint-disable */
//
// Refund / forward funds from a DFX EVM deposit address.
//
// Bootstraps the NestJS application context and uses the existing
// BlockchainRegistryService + EvmClient to derive the deposit wallet
// (EVM_DEPOSIT_SEED + accountIndex) and forward a chosen asset to a chosen
// recipient. Recipient can be derived from a deposit transaction (sender of
// that tx).
//
// Default behaviour is DRY-RUN. Pass --execute to broadcast.
//
// Where to run:
//   The deposit seed only lives in the api container env. On prd this is the
//   Azure App Service `app-dfx-api-prd`. SSH in and run from /home/site/wwwroot:
//
//     az webapp ssh -g <rg> -n app-dfx-api-prd
//     cd /home/site/wwwroot
//     node scripts/refund-deposit.js --help
//
// Usage:
//   node scripts/refund-deposit.js \
//     --chain citrea \
//     --account-index 4486 \
//     --asset native \
//     --amount all \
//     --to-sender-of 0x8b3bbec3... \
//     [--execute]
//
//   node scripts/refund-deposit.js \
//     --chain ethereum \
//     --account-index 4486 \
//     --asset 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
//     --amount 100 \
//     --to 0xRECIPIENT \
//     [--execute]
//

const { ethers } = require('ethers');

// Heavy NestJS / dist requires are deferred to main() so that --help and
// argument validation work without bootstrapping the application context.

const CHAIN_NAMES = ['ethereum', 'optimism', 'arbitrum', 'polygon', 'base', 'bsc', 'gnosis', 'citrea'];

const EXPLORERS = {
  Ethereum: 'https://etherscan.io',
  Optimism: 'https://optimistic.etherscan.io',
  Arbitrum: 'https://arbiscan.io',
  Polygon: 'https://polygonscan.com',
  Base: 'https://basescan.org',
  BinanceSmartChain: 'https://bscscan.com',
  Gnosis: 'https://gnosisscan.io',
  Citrea: 'https://citreascan.com',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') { args.execute = true; continue; }
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = val;
      i++;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Refund / forward funds from a DFX EVM deposit address.

Required:
  --chain <name>           ${CHAIN_NAMES.join(', ')}
  --account-index <N>      Deposit address slot (BIP-44 m/44'/60'/0'/0/N)
  --asset native|<addr>    'native' or ERC20 contract address
  --amount all|<float>     'all' to sweep everything

One of:
  --to <address>           Explicit recipient
  --to-sender-of <txHash>  Use the 'from' of that transaction as recipient

Optional:
  --execute                Broadcast (default: dry-run)
  -h, --help               This help
`);
}

function validateArgs(args) {
  const chainName = args.chain;
  if (!chainName || !CHAIN_NAMES.includes(chainName)) {
    throw new Error(`Unknown --chain (have: ${CHAIN_NAMES.join(', ')})`);
  }

  const accountIndex = args['account-index'];
  if (accountIndex == null || !/^\d+$/.test(accountIndex)) {
    throw new Error('--account-index must be a non-negative integer');
  }

  const asset = args.asset;
  if (!asset) throw new Error('--asset is required (native|<contract>)');
  const isNative = asset === 'native';
  if (!isNative && !ethers.utils.isAddress(asset)) {
    throw new Error('--asset must be "native" or a valid contract address');
  }

  const amountArg = args.amount;
  if (!amountArg) throw new Error('--amount is required (all|<float>)');

  const explicitTo = args.to;
  const toSenderOfTx = args['to-sender-of'];
  if (!explicitTo && !toSenderOfTx) {
    throw new Error('Need --to <addr> OR --to-sender-of <txHash>');
  }
  if (explicitTo && toSenderOfTx) {
    throw new Error('--to and --to-sender-of are mutually exclusive');
  }
  if (explicitTo && !ethers.utils.isAddress(explicitTo)) {
    throw new Error('--to must be a valid address');
  }

  return {
    chainName,
    accountIndex: parseInt(accountIndex, 10),
    asset,
    isNative,
    amountArg,
    sweepAll: amountArg === 'all',
    explicitTo,
    toSenderOfTx,
    execute: !!args.execute,
  };
}

async function resolveRecipient(provider, opts) {
  if (opts.explicitTo) return ethers.utils.getAddress(opts.explicitTo);

  console.log(`\nResolving sender of tx ${opts.toSenderOfTx} ...`);
  const tx = await provider.getTransaction(opts.toSenderOfTx);
  if (!tx) throw new Error(`Transaction ${opts.toSenderOfTx} not found on ${opts.chainName}`);
  const sender = ethers.utils.getAddress(tx.from);
  console.log(`  → sender: ${sender}`);
  return sender;
}

async function resolveAsset(assetService, AssetType, blockchain, opts) {
  if (opts.isNative) {
    const native = await assetService.getNativeAsset(blockchain);
    if (!native) throw new Error(`No native asset configured for ${blockchain}`);
    return native;
  }
  const token = await assetService.getAssetByChainId(blockchain, opts.asset);
  if (!token) throw new Error(`No asset entity for contract ${opts.asset} on ${blockchain}`);
  if (token.type !== AssetType.TOKEN) throw new Error(`Asset ${token.name} is not a TOKEN`);
  return token;
}

async function main() {
  const rawArgs = parseArgs(process.argv);
  if (rawArgs.help) { printHelp(); return; }
  const opts = validateArgs(rawArgs);

  if (!process.env.EVM_DEPOSIT_SEED) {
    throw new Error('EVM_DEPOSIT_SEED env var is not set');
  }

  // Defer heavy NestJS / dist requires until args are validated, so --help and
  // input errors don't trigger application-context bootstrap.
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/src/app.module');
  const {
    BlockchainRegistryService,
  } = require('../dist/src/integration/blockchain/shared/services/blockchain-registry.service');
  const { AssetService } = require('../dist/src/shared/models/asset/asset.service');
  const { Blockchain } = require('../dist/src/integration/blockchain/shared/enums/blockchain.enum');
  const { AssetType } = require('../dist/src/shared/models/asset/asset.entity');
  const { EvmUtil } = require('../dist/src/integration/blockchain/shared/evm/evm.util');
  const { GetConfig } = require('../dist/src/config/config');

  const CHAIN_TO_ENUM = {
    ethereum: Blockchain.ETHEREUM,
    optimism: Blockchain.OPTIMISM,
    arbitrum: Blockchain.ARBITRUM,
    polygon: Blockchain.POLYGON,
    base: Blockchain.BASE,
    bsc: Blockchain.BINANCE_SMART_CHAIN,
    gnosis: Blockchain.GNOSIS,
    citrea: Blockchain.CITREA,
  };
  const blockchain = CHAIN_TO_ENUM[opts.chainName];

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const registry = app.get(BlockchainRegistryService);
    const assetService = app.get(AssetService);

    const client = registry.getEvmClient(blockchain);
    const account = GetConfig().blockchain.evm.walletAccount(opts.accountIndex);
    const wallet = EvmUtil.createWallet(account);
    const fromAddress = wallet.address;

    console.log('=== DFX Deposit Refund ===');
    console.log(`Chain:           ${opts.chainName} (${blockchain})`);
    console.log(`Account index:   ${opts.accountIndex}`);
    console.log(`Deposit address: ${fromAddress}`);

    const recipient = await resolveRecipient(client.provider, opts);
    if (recipient.toLowerCase() === fromAddress.toLowerCase()) {
      throw new Error('Refusing to send to deposit address itself');
    }
    console.log(`Recipient:       ${recipient}`);

    const asset = await resolveAsset(assetService, AssetType, blockchain, opts);
    const nativeBalance = await client.getNativeCoinBalanceForAddress(fromAddress);

    let sendAmount;
    if (opts.isNative) {
      if (nativeBalance <= 0) throw new Error(`Native balance is 0 ${asset.name}`);
      // Estimate fee, then sweep balance - fee (with safety buffer) when sweepAll.
      const gasPrice = await client.getRecommendedGasPrice();
      const provider = client.provider;
      const probeValue = ethers.utils.parseEther(nativeBalance.toString());
      const estimated = await provider.estimateGas({ from: fromAddress, to: recipient, value: probeValue });
      const fee = +ethers.utils.formatEther(estimated.mul(gasPrice));
      if (opts.sweepAll) {
        sendAmount = nativeBalance - fee;
        if (sendAmount <= 0) throw new Error(`Native balance ${nativeBalance} ${asset.name} ≤ tx fee ${fee} ${asset.name}`);
      } else {
        sendAmount = parseFloat(opts.amountArg);
        if (sendAmount + fee > nativeBalance) {
          throw new Error(`Need ${sendAmount + fee} ${asset.name}, have ${nativeBalance} ${asset.name}`);
        }
      }
      console.log(`\nNative balance:  ${nativeBalance} ${asset.name}`);
      console.log(`Estimated fee:   ${fee} ${asset.name}`);
    } else {
      const tokenBalance = await client.getTokenBalance(asset, fromAddress);
      if (tokenBalance <= 0) throw new Error(`Token balance is 0 for ${asset.name}`);
      sendAmount = opts.sweepAll ? tokenBalance : parseFloat(opts.amountArg);
      if (sendAmount > tokenBalance) {
        throw new Error(`Need ${sendAmount} ${asset.name}, have ${tokenBalance} ${asset.name}`);
      }
      if (nativeBalance <= 0) throw new Error(`Native balance is 0 — cannot pay gas for token transfer`);
      console.log(`\nToken balance:   ${tokenBalance} ${asset.name}`);
      console.log(`Native balance:  ${nativeBalance} (for gas)`);
    }

    console.log('\n--- Plan ---');
    console.log(`Send ${sendAmount} ${asset.name} from ${fromAddress} to ${recipient}`);

    if (!opts.execute) {
      console.log('\nDRY RUN — pass --execute to broadcast.');
      return;
    }

    console.log('\nBroadcasting...');
    const txHash = opts.isNative
      ? await client.sendNativeCoinFromAccount(account, recipient, sendAmount)
      : await client.sendTokenFromAccount(account, recipient, asset, sendAmount);

    const explorer = EXPLORERS[blockchain];
    console.log(`Tx hash:         ${txHash}`);
    console.log(`Explorer:        ${explorer}/tx/${txHash}`);
    console.log('Waiting for 1 confirmation...');
    const receipt = await client.provider.waitForTransaction(txHash, 1);
    console.log(`Confirmed in block ${receipt.blockNumber}, status=${receipt.status === 1 ? 'OK' : 'FAILED'}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
