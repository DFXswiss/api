import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import * as bitcoin from 'bitcoinjs-lib';
import { wordlist } from '@scure/bip39/wordlists/english';

// Use the example seed from our previous generation
const EXAMPLE_MNEMONIC = "flush fiscal rib invest then magic include frame balcony aerobic smile host laugh dune cannon praise circle ghost make mercy bid bounce file purchase";

function generateSparkAddresses() {
    console.log('=== Generating Bitcoin-Style Addresses for Spark ===\n');

    // Convert mnemonic to seed
    const seed = mnemonicToSeedSync(EXAMPLE_MNEMONIC);
    console.log('📝 Using Example Seed Phrase:\n' + EXAMPLE_MNEMONIC);
    console.log('\n🔑 Seed (Hex):', Buffer.from(seed).toString('hex'));

    // Derive HD wallet from seed
    const hdWallet = HDKey.fromMasterSeed(seed);

    console.log('\n📍 Generated Addresses:\n');

    const addresses = [];

    for (let i = 0; i < 3; i++) {
        // BIP44 path for Bitcoin/Spark: m/44'/0'/i'/0/0
        const path = `m/44'/0'/${i}'/0/0`;
        const child = hdWallet.derive(path);

        const publicKey = Buffer.from(child.publicKey);
        const privateKey = Buffer.from(child.privateKey);

        // Generate addresses using bitcoinjs-lib
        // 1. Legacy P2PKH Address (starts with 1)
        const { address: p2pkhAddress } = bitcoin.payments.p2pkh({
            pubkey: publicKey,
            network: bitcoin.networks.bitcoin
        });

        // 2. Native SegWit Address (bech32, starts with bc1)
        const { address: p2wpkhAddress } = bitcoin.payments.p2wpkh({
            pubkey: publicKey,
            network: bitcoin.networks.bitcoin
        });

        // 3. Nested SegWit Address (starts with 3)
        const { address: p2shAddress } = bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({
                pubkey: publicKey,
                network: bitcoin.networks.bitcoin
            }),
            network: bitcoin.networks.bitcoin
        });

        addresses.push({
            path,
            privateKey: privateKey.toString('hex'),
            publicKey: publicKey.toString('hex'),
            addresses: {
                p2pkh: p2pkhAddress,
                p2wpkh: p2wpkhAddress,
                p2sh: p2shAddress
            }
        });

        console.log(`Account ${i} (${path}):`);
        console.log(`  Private Key: ${privateKey.toString('hex')}`);
        console.log(`  Public Key:  ${publicKey.toString('hex')}`);
        console.log(`  Addresses:`);
        console.log(`    Legacy (P2PKH):       ${p2pkhAddress}`);
        console.log(`    Native SegWit:        ${p2wpkhAddress}`);
        console.log(`    Nested SegWit (P2SH): ${p2shAddress}`);
        console.log('');
    }

    // Generate testnet addresses for the first account
    console.log('🧪 Testnet Addresses (Account 0):\n');
    const testnetChild = hdWallet.derive(`m/44'/0'/0'/0/0`);
    const testnetPubKey = Buffer.from(testnetChild.publicKey);

    const { address: testnetP2pkh } = bitcoin.payments.p2pkh({
        pubkey: testnetPubKey,
        network: bitcoin.networks.testnet
    });

    const { address: testnetP2wpkh } = bitcoin.payments.p2wpkh({
        pubkey: testnetPubKey,
        network: bitcoin.networks.testnet
    });

    console.log(`  Legacy Testnet:  ${testnetP2pkh}`);
    console.log(`  SegWit Testnet:  ${testnetP2wpkh}`);

    return {
        mnemonic: EXAMPLE_MNEMONIC,
        seed: Buffer.from(seed).toString('hex'),
        accounts: addresses,
        testnet: {
            p2pkh: testnetP2pkh,
            p2wpkh: testnetP2wpkh
        },
        generated: new Date().toISOString()
    };
}

// Run the generator
if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const result = generateSparkAddresses();

        // Save to file
        import('fs/promises').then(fs => {
            fs.writeFile(
                './spark-addresses.json',
                JSON.stringify(result, null, 2),
                'utf8'
            ).then(() => {
                console.log('\n💾 Addresses saved to: ./spark-addresses.json');
                console.log('\n✨ Address generation complete!');
            });
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

export { generateSparkAddresses };