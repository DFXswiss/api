import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { wordlist } from '@scure/bip39/wordlists/english';
import fs from 'fs/promises';

async function generateSeedSignatureExamples() {
    console.log('=== Spark Seed & Signature Examples ===\n');

    // 1. Generate a BIP39 mnemonic seed phrase
    const mnemonic = generateMnemonic(wordlist, 256); // 24 words for maximum security
    console.log('📝 Mnemonic Seed Phrase (24 words):');
    console.log(mnemonic);
    console.log('\n⚠️  WICHTIG: Dies ist ein Beispiel-Seed. Niemals in Produktion verwenden!\n');

    // 2. Convert mnemonic to seed
    const seed = mnemonicToSeedSync(mnemonic);
    console.log('🔑 Seed (Hex):', Buffer.from(seed).toString('hex'));

    // 3. Derive HD wallet from seed
    const hdWallet = HDKey.fromMasterSeed(seed);

    // 4. Derive multiple accounts following BIP44 path: m/44'/0'/account'/0/0
    const accounts = [];

    for (let i = 0; i < 3; i++) {
        // BIP44 path for Bitcoin: m/44'/0'/i'/0/0
        const path = `m/44'/0'/${i}'/0/0`;
        const child = hdWallet.derive(path);

        accounts.push({
            path,
            privateKey: Buffer.from(child.privateKey).toString('hex'),
            publicKey: Buffer.from(child.publicKey).toString('hex'),
            address: `spark_address_${i}` // Placeholder for Spark address
        });

        console.log(`\n📍 Account ${i} (${path}):`);
        console.log(`   Private Key: ${Buffer.from(child.privateKey).toString('hex')}`);
        console.log(`   Public Key: ${Buffer.from(child.publicKey).toString('hex')}`);
    }

    // 5. Create example messages
    const messages = [
        {
            id: 'msg_001',
            type: 'payment',
            content: 'Send 0.5 BTC to spark1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
            timestamp: new Date().toISOString()
        },
        {
            id: 'msg_002',
            type: 'authentication',
            content: 'Authenticate user session: 7f3b4c8d-9e2a-4f1b-a5e7-2d8c9f0e3b6a',
            timestamp: new Date().toISOString()
        },
        {
            id: 'msg_003',
            type: 'contract',
            content: JSON.stringify({
                action: 'deploy_contract',
                contractHash: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb5',
                network: 'spark_testnet'
            }),
            timestamp: new Date().toISOString()
        },
        {
            id: 'msg_004',
            type: 'verification',
            content: 'Verify ownership of wallet spark1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
            timestamp: new Date().toISOString()
        },
        {
            id: 'msg_005',
            type: 'multisig',
            content: JSON.stringify({
                threshold: 2,
                signers: ['alice', 'bob', 'charlie'],
                operation: 'approve_transaction',
                txId: 'tx_9f8e7d6c5b4a3210'
            }),
            timestamp: new Date().toISOString()
        }
    ];

    // 6. Generate signatures for each message with each account
    const signatures = [];

    console.log('\n\n📝 === Generating Signatures ===\n');

    for (const account of accounts) {
        console.log(`\n🔐 Signing with Account ${accounts.indexOf(account)} (${account.path}):`);

        for (const message of messages) {
            // Create deterministic message to sign
            const messageToSign = `${message.type}:${message.content}:${message.timestamp}`;
            const messageHash = sha256(new TextEncoder().encode(messageToSign));

            // Sign the message
            const signature = secp256k1.sign(messageHash, Buffer.from(account.privateKey, 'hex'));

            const signatureData = {
                messageId: message.id,
                accountPath: account.path,
                publicKey: account.publicKey,
                message: messageToSign,
                messageHash: Buffer.from(messageHash).toString('hex'),
                signature: {
                    compact: signature.toCompactHex(),
                    r: signature.r.toString(16),
                    s: signature.s.toString(16),
                    recovery: signature.recovery
                },
                timestamp: message.timestamp
            };

            signatures.push(signatureData);

            // Verify the signature
            const isValid = secp256k1.verify(
                signature.toCompactHex(),
                messageHash,
                Buffer.from(account.publicKey, 'hex')
            );

            console.log(`   ${message.id}: ${isValid ? '✅' : '❌'} ${message.type}`);
        }
    }

    // 7. Create example data structure
    const exampleData = {
        metadata: {
            version: '1.0.0',
            created: new Date().toISOString(),
            network: 'spark_testnet',
            description: 'Spark Money Wallet Signature Examples'
        },
        seed: {
            mnemonic: mnemonic,
            seedHex: Buffer.from(seed).toString('hex'),
            warning: '⚠️ THIS IS AN EXAMPLE SEED - NEVER USE IN PRODUCTION!'
        },
        accounts: accounts,
        messages: messages,
        signatures: signatures,
        verificationExamples: [
            {
                description: 'Verify first payment message with first account',
                messageId: 'msg_001',
                accountIndex: 0,
                expectedResult: true
            },
            {
                description: 'Verify authentication message with second account',
                messageId: 'msg_002',
                accountIndex: 1,
                expectedResult: true
            }
        ]
    };

    // 8. Save to JSON file
    const jsonFilePath = './signature-examples.json';
    await fs.writeFile(
        jsonFilePath,
        JSON.stringify(exampleData, null, 2),
        'utf8'
    );

    console.log(`\n\n💾 Examples saved to: ${jsonFilePath}`);

    // 9. Create a compact summary
    const summary = {
        mnemonic: mnemonic.split(' ').slice(0, 4).join(' ') + ' ... [24 words total]',
        totalAccounts: accounts.length,
        totalMessages: messages.length,
        totalSignatures: signatures.length,
        file: jsonFilePath
    };

    console.log('\n\n📊 === Summary ===');
    console.log(JSON.stringify(summary, null, 2));

    // 10. Demonstrate signature verification
    console.log('\n\n🔍 === Signature Verification Demo ===\n');

    // Verify first signature
    const firstSig = signatures[0];
    console.log('Verifying first signature:');
    console.log(`  Message: ${firstSig.message.substring(0, 50)}...`);
    console.log(`  Public Key: ${firstSig.publicKey.substring(0, 20)}...`);
    console.log(`  Signature R: ${firstSig.signature.r.substring(0, 20)}...`);

    const verifyResult = secp256k1.verify(
        firstSig.signature.compact,
        Buffer.from(firstSig.messageHash, 'hex'),
        Buffer.from(firstSig.publicKey, 'hex')
    );

    console.log(`  Verification: ${verifyResult ? '✅ VALID' : '❌ INVALID'}`);

    return exampleData;
}

// Function to verify any signature from the examples
export function verifyExampleSignature(signatureData) {
    try {
        const messageHash = sha256(new TextEncoder().encode(signatureData.message));

        return secp256k1.verify(
            signatureData.signature.compact,
            messageHash,
            Buffer.from(signatureData.publicKey, 'hex')
        );
    } catch (error) {
        console.error('Verification error:', error);
        return false;
    }
}

// Run the example generator
if (import.meta.url === `file://${process.argv[1]}`) {
    generateSeedSignatureExamples()
        .then(() => {
            console.log('\n✨ === Example generation complete! ===\n');
        })
        .catch(error => {
            console.error('Error:', error);
            process.exit(1);
        });
}

export { generateSeedSignatureExamples };