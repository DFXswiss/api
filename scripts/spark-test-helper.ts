import { SparkWallet } from '@buildonspark/spark-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SEED = process.env.SPARK_WALLET_SEED ?? process.env.WALLET_SEED_PHRASE;

async function getWallet(): Promise<InstanceType<typeof SparkWallet>> {
  if (!SEED) {
    console.error('Error: No seed phrase found. Set SPARK_WALLET_SEED or WALLET_SEED_PHRASE in .env.local');
    process.exit(1);
  }

  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: SEED,
    accountNumber: 0,
    options: { network: 'MAINNET' },
  });

  return wallet;
}

async function showAddress(): Promise<void> {
  const wallet = await getWallet();
  const address = await wallet.getSparkAddress();
  console.log('Spark Address:', address);
  await wallet.cleanupConnections();
}

async function signMessage(message: string): Promise<void> {
  const wallet = await getWallet();
  const signature = await wallet.signMessageWithIdentityKey(message, true);
  console.log('Message:', message);
  console.log('Signature (hex):', signature);
  await wallet.cleanupConnections();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'address':
      await showAddress();
      break;

    case 'sign':
      if (!args[0]) {
        console.error('Usage: npx ts-node scripts/spark-test-helper.ts sign "message"');
        process.exit(1);
      }
      await signMessage(args[0]);
      break;

    default:
      console.log('Spark Test Helper');
      console.log('');
      console.log('Usage:');
      console.log('  npx ts-node scripts/spark-test-helper.ts address          Show Spark wallet address');
      console.log('  npx ts-node scripts/spark-test-helper.ts sign "message"   Sign a message');
      console.log('');
      console.log('Environment:');
      console.log('  Set SPARK_WALLET_SEED or WALLET_SEED_PHRASE in .env.local');
      break;
  }
}

main().catch((e) => {
  console.error('Error:', e.message ?? e);
  process.exit(1);
});
