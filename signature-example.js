import { DefaultSparkSigner, TaprootSparkSigner } from '@buildonspark/spark-sdk';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

async function signatureExample() {
    console.log('=== Spark Signature Example ===\n');

    // 1. Generate a private key for signing
    const privateKey = randomBytes(32);
    const publicKey = secp256k1.getPublicKey(privateKey, true); // compressed public key
    console.log('Private Key:', Buffer.from(privateKey).toString('hex'));
    console.log('Public Key:', Buffer.from(publicKey).toString('hex'));

    // 2. Create SparkSigner instance
    const signer = new DefaultSparkSigner();

    // 3. Create a message to sign
    const message = 'Hello Spark! This is a test message for signature verification.';
    console.log('\nMessage to sign:', message);

    // 4. Hash the message
    const messageHash = sha256(new TextEncoder().encode(message));
    console.log('Message Hash:', Buffer.from(messageHash).toString('hex'));

    // 5. Sign the message using secp256k1
    const signature = secp256k1.sign(messageHash, privateKey);
    const signatureCompact = signature.toCompactHex();
    console.log('\nSignature (Compact Hex):', signatureCompact);
    console.log('Signature R:', signature.r.toString(16));
    console.log('Signature S:', signature.s.toString(16));
    console.log('Recovery bit:', signature.recovery);

    // 6. Verify the signature
    const isValid = secp256k1.verify(
        signatureCompact,
        messageHash,
        publicKey
    );

    console.log('\nSignature Verification:', isValid ? '✅ Valid' : '❌ Invalid');

    // 7. Test with tampered message
    console.log('\n--- Testing with tampered message ---');
    const tamperedMessage = 'Hello Spark! This message has been tampered.';
    const tamperedHash = sha256(new TextEncoder().encode(tamperedMessage));
    console.log('Tampered message:', tamperedMessage);
    console.log('Tampered hash:', Buffer.from(tamperedHash).toString('hex'));

    const isTamperedValid = secp256k1.verify(
        signatureCompact,
        tamperedHash,
        publicKey
    );

    console.log('Tampered Message Verification:', isTamperedValid ? '✅ Valid' : '❌ Invalid (Expected)');

    // 8. Demonstrate signature recovery (recovering public key from signature)
    console.log('\n--- Signature Recovery ---');
    const recoveredPubKey = signature.recoverPublicKey(messageHash);
    const recoveredPubKeyHex = recoveredPubKey.toHex(true);
    console.log('Recovered Public Key:', recoveredPubKeyHex);
    console.log('Keys match:', recoveredPubKeyHex === Buffer.from(publicKey).toString('hex'));

    return {
        privateKey: Buffer.from(privateKey).toString('hex'),
        publicKey: Buffer.from(publicKey).toString('hex'),
        message,
        signature: signatureCompact,
        isValid
    };
}

// Additional verification function for demonstration
function verifySignatureManual(message, signatureHex, publicKeyHex) {
    const messageHash = sha256(new TextEncoder().encode(message));
    const publicKey = Uint8Array.from(Buffer.from(publicKeyHex, 'hex'));

    return secp256k1.verify(
        signatureHex,
        messageHash,
        publicKey
    );
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
    signatureExample()
        .then(result => {
            console.log('\n=== Example Complete ===');
            console.log('Signature verification successful!');
        })
        .catch(error => {
            console.error('Error:', error);
            process.exit(1);
        });
}

export { signatureExample, verifySignatureManual };