import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';

// Use the example seed from our previous generation
const EXAMPLE_MNEMONIC = "flush fiscal rib invest then magic include frame balcony aerobic smile host laugh dune cannon praise circle ghost make mercy bid bounce file purchase";

// Spark network prefixes
const SPARK_PREFIXES = {
    mainnet: 'sp',
    testnet: 'spt',
    regtest: 'sprt',
    signet: 'sps',
    local: 'spl'
};

// Simple Spark address encoding (without protobuf for demonstration)
function encodeSparkAddress(publicKey, network = 'mainnet') {
    // Get the network prefix
    const prefix = SPARK_PREFIXES[network];

    // For a basic Spark address, we use the public key directly
    // In production, this would be wrapped in a protobuf structure

    // Convert public key to 5-bit groups for bech32m
    const words = bech32m.toWords(publicKey);

    // Encode with bech32m
    const address = bech32m.encode(prefix, words, 1024);

    return address;
}

function generateRealSparkAddresses() {
    console.log('=== Generating Real Spark Addresses ===\n');

    // Convert mnemonic to seed
    const seed = mnemonicToSeedSync(EXAMPLE_MNEMONIC);
    console.log('📝 Using Example Seed Phrase:\n' + EXAMPLE_MNEMONIC);
    console.log('\n🔑 Seed (Hex):', Buffer.from(seed).toString('hex'));

    // Derive HD wallet from seed
    const hdWallet = HDKey.fromMasterSeed(seed);

    console.log('\n📍 Generated Spark Addresses:\n');

    const addresses = [];

    for (let i = 0; i < 3; i++) {
        // BIP44 path for Spark: m/44'/0'/i'/0/0
        const path = `m/44'/0'/${i}'/0/0`;
        const child = hdWallet.derive(path);

        const publicKey = Buffer.from(child.publicKey);
        const privateKey = Buffer.from(child.privateKey);

        // Generate Spark addresses for different networks
        const mainnetAddress = encodeSparkAddress(publicKey, 'mainnet');
        const testnetAddress = encodeSparkAddress(publicKey, 'testnet');

        addresses.push({
            path,
            privateKey: privateKey.toString('hex'),
            publicKey: publicKey.toString('hex'),
            sparkAddresses: {
                mainnet: mainnetAddress,
                testnet: testnetAddress
            }
        });

        console.log(`Account ${i} (${path}):`);
        console.log(`  Private Key: ${privateKey.toString('hex')}`);
        console.log(`  Public Key:  ${publicKey.toString('hex')}`);
        console.log(`  Spark Addresses:`);
        console.log(`    Mainnet:  ${mainnetAddress}`);
        console.log(`    Testnet:  ${testnetAddress}`);
        console.log('');
    }

    // Create a sample Spark invoice address (with mock invoice data)
    console.log('📄 Sample Spark Invoice Address:\n');

    // For demonstration, create a simple invoice-like structure
    const invoiceData = {
        identityKey: Buffer.from(hdWallet.derive(`m/44'/0'/0'/0/0`).publicKey),
        amount: 100000, // sats
        memo: 'Test payment',
        timestamp: Date.now()
    };

    // Hash the invoice data
    const invoiceHash = sha256(Buffer.concat([
        invoiceData.identityKey,
        Buffer.from(invoiceData.amount.toString()),
        Buffer.from(invoiceData.memo)
    ]));

    // Create extended data for invoice address
    const invoicePayload = Buffer.concat([
        invoiceData.identityKey,
        invoiceHash
    ]);

    const invoiceAddress = encodeSparkAddress(invoicePayload, 'testnet');
    console.log(`  Invoice Address (Testnet): ${invoiceAddress}`);
    console.log(`  Amount: ${invoiceData.amount} sats`);
    console.log(`  Memo: ${invoiceData.memo}`);

    return {
        mnemonic: EXAMPLE_MNEMONIC,
        seed: Buffer.from(seed).toString('hex'),
        accounts: addresses,
        sampleInvoice: {
            address: invoiceAddress,
            amount: invoiceData.amount,
            memo: invoiceData.memo
        },
        generated: new Date().toISOString()
    };
}

// Run the generator
if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const result = generateRealSparkAddresses();

        // Save to file
        import('fs/promises').then(fs => {
            fs.writeFile(
                './real-spark-addresses.json',
                JSON.stringify(result, null, 2),
                'utf8'
            ).then(() => {
                console.log('\n💾 Spark addresses saved to: ./real-spark-addresses.json');
                console.log('\n✨ Spark address generation complete!');
                console.log('\n📌 Note: These are Spark-specific addresses using bech32m encoding');
                console.log('   with Spark network prefixes (sp1, spt1, etc.)');
            });
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

export { generateRealSparkAddresses };