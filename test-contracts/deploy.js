/**
 * Deploy test contracts to Sepolia and set up state for BrokerBot sell test
 */
const { createWalletClient, createPublicClient, http, parseEther, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');
const fs = require('fs');
const path = require('path');

const ALCHEMY_KEY = process.env.ALCHEMY_KEY;
const RELAYER_KEY = process.env.SEPOLIA_WALLET_PRIVATE_KEY;
const USER_KEY = process.env.TEST_PRIVATE_KEY;

if (!ALCHEMY_KEY || !RELAYER_KEY || !USER_KEY) {
  console.error('Required env vars: ALCHEMY_KEY, SEPOLIA_WALLET_PRIVATE_KEY, TEST_PRIVATE_KEY');
  process.exit(1);
}

const RPC_URL = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`;

const relayerAccount = privateKeyToAccount(RELAYER_KEY);
const userAccount = privateKeyToAccount(USER_KEY);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const relayerWallet = createWalletClient({ account: relayerAccount, chain: sepolia, transport: http(RPC_URL) });

// Price: 1.57 CHF per share (matching the mock)
const PRICE_PER_SHARE = parseEther('1.57');

function loadArtifact(name) {
  const artifactPath = path.join(__dirname, 'out', 'TestContracts.sol', `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

async function deploy(name, args = []) {
  const { abi, bytecode } = loadArtifact(name);

  console.log(`Deploying ${name}...`);
  const hash = await relayerWallet.deployContract({
    abi,
    bytecode,
    args,
  });

  console.log(`  TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Address: ${receipt.contractAddress}`);
  console.log(`  Gas: ${receipt.gasUsed}`);

  return { address: receipt.contractAddress, abi };
}

async function main() {
  const relayerBalance = await publicClient.getBalance({ address: relayerAccount.address });
  console.log(`Relayer: ${relayerAccount.address} (${formatEther(relayerBalance)} ETH)`);
  console.log(`Test user: ${userAccount.address}\n`);

  // 1. Deploy tokens
  const realu = await deploy('TestREALU');
  const zchf = await deploy('TestZCHF');

  // 2. Deploy BrokerBot
  const brokerbot = await deploy('TestBrokerBot', [realu.address, zchf.address, PRICE_PER_SHARE]);

  console.log('\n=== Contracts deployed ===');
  console.log(`TestREALU:     ${realu.address}`);
  console.log(`TestZCHF:      ${zchf.address}`);
  console.log(`TestBrokerBot: ${brokerbot.address}`);

  // 3. Mint REALU to test user (100 shares, as whole tokens with 18 decimals)
  console.log('\n=== Setting up state ===');
  const mintRealuHash = await relayerWallet.writeContract({
    address: realu.address,
    abi: realu.abi,
    functionName: 'mint',
    args: [userAccount.address, parseEther('100')],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintRealuHash });
  console.log(`Minted 100 REALU to user: ${mintRealuHash}`);

  // 4. Mint ZCHF to BrokerBot (10000 ZCHF liquidity)
  const mintZchfHash = await relayerWallet.writeContract({
    address: zchf.address,
    abi: zchf.abi,
    functionName: 'mint',
    args: [brokerbot.address, parseEther('10000')],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintZchfHash });
  console.log(`Minted 10000 ZCHF to BrokerBot: ${mintZchfHash}`);

  // 5. Verify balances
  const userRealu = await publicClient.readContract({
    address: realu.address,
    abi: realu.abi,
    functionName: 'balanceOf',
    args: [userAccount.address],
  });
  const botZchf = await publicClient.readContract({
    address: zchf.address,
    abi: zchf.abi,
    functionName: 'balanceOf',
    args: [brokerbot.address],
  });
  console.log(`\nUser REALU balance: ${formatEther(userRealu)}`);
  console.log(`BrokerBot ZCHF balance: ${formatEther(botZchf)}`);

  // 6. Output config update
  console.log('\n=== Update these in realunit-blockchain.service.ts ===');
  console.log(`BROKERBOT_ADDRESS = '${brokerbot.address}';`);
  console.log(`REALU_TOKEN_ADDRESS = '${realu.address}';`);
  console.log(`ZCHF_ADDRESS = '${zchf.address}';`);

  // Save addresses to file
  const addresses = {
    realu: realu.address,
    zchf: zchf.address,
    brokerbot: brokerbot.address,
    pricePerShare: '1.57',
    network: 'sepolia',
    deployer: relayerAccount.address,
    testUser: userAccount.address,
  };
  fs.writeFileSync(path.join(__dirname, 'deployed-addresses.json'), JSON.stringify(addresses, null, 2));
  console.log('\nSaved to deployed-addresses.json');

  const finalBalance = await publicClient.getBalance({ address: relayerAccount.address });
  console.log(`\nRelayer remaining: ${formatEther(finalBalance)} ETH`);
}

main().catch(console.error);
