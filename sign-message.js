import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

// Use the example seed from our previous generation
const EXAMPLE_MNEMONIC = "flush fiscal rib invest then magic include frame balcony aerobic smile host laugh dune cannon praise circle ghost make mercy bid bounce file purchase";

function signMessage() {
    console.log('=== Signing Message with Account 0 ===\n');

    // The message to sign
    const message = "Hallo_Montag";
    console.log('📝 Message to sign:', message);

    // Convert mnemonic to seed
    const seed = mnemonicToSeedSync(EXAMPLE_MNEMONIC);

    // Derive HD wallet from seed
    const hdWallet = HDKey.fromMasterSeed(seed);

    // Derive Account 0: m/44'/0'/0'/0/0
    const path = "m/44'/0'/0'/0/0";
    const account0 = hdWallet.derive(path);

    const privateKey = Buffer.from(account0.privateKey);
    const publicKey = Buffer.from(account0.publicKey);

    console.log('\n🔑 Account 0 Details:');
    console.log('  Path:', path);
    console.log('  Private Key:', privateKey.toString('hex'));
    console.log('  Public Key:', publicKey.toString('hex'));

    // Hash the message
    const messageBytes = new TextEncoder().encode(message);
    const messageHash = sha256(messageBytes);

    console.log('\n📊 Message Hash:', Buffer.from(messageHash).toString('hex'));

    // Sign the message
    const signature = secp256k1.sign(messageHash, privateKey);

    console.log('\n✍️ Signature Components:');
    console.log('  R:', signature.r.toString(16).padStart(64, '0'));
    console.log('  S:', signature.s.toString(16).padStart(64, '0'));
    console.log('  Recovery bit:', signature.recovery);
    console.log('\n📄 Compact Signature (R+S):', signature.toCompactHex());

    // Verify the signature
    const isValid = secp256k1.verify(
        signature.toCompactHex(),
        messageHash,
        publicKey
    );

    console.log('\n✅ Signature Verification:', isValid ? 'VALID' : 'INVALID');

    // Create DER format signature (commonly used in Bitcoin)
    const derSignature = signature.toDERHex();
    console.log('\n📦 DER Format Signature:', derSignature);

    // Create result object
    const result = {
        message: message,
        account: {
            path: path,
            publicKey: publicKey.toString('hex'),
            sparkAddress: {
                mainnet: 'sp1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg',
                testnet: 'spt1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrgnela9c'
            }
        },
        signature: {
            messageHash: Buffer.from(messageHash).toString('hex'),
            r: signature.r.toString(16).padStart(64, '0'),
            s: signature.s.toString(16).padStart(64, '0'),
            recovery: signature.recovery,
            compact: signature.toCompactHex(),
            der: derSignature
        },
        timestamp: new Date().toISOString(),
        verified: isValid
    };

    // Save to file
    import('fs/promises').then(fs => {
        fs.writeFile(
            './signed-message.json',
            JSON.stringify(result, null, 2),
            'utf8'
        ).then(() => {
            console.log('\n💾 Signed message saved to: ./signed-message.json');
        });
    });

    console.log('\n=== Signature Summary ===');
    console.log('Message:', message);
    console.log('Signed by: Account 0 (sp1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg)');
    console.log('Signature (compact):', signature.toCompactHex());

    return result;
}

// Run the signing
if (import.meta.url === `file://${process.argv[1]}`) {
    signMessage();
}

export { signMessage };