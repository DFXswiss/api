import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32m } from '@scure/base';

/**
 * Verify a signature without knowing the recovery bit
 * by trying all 4 possible recovery values
 */
function verifyWithoutRecoveryBit(message, signatureHex, sparkAddress) {
    console.log('=== Signature Verification without Recovery Bit ===\n');

    console.log('📝 Input:');
    console.log('  Message:', message);
    console.log('  Signature:', signatureHex);
    console.log('  Spark Address:', sparkAddress);
    console.log('');

    // Parse the signature (R and S components)
    const signatureBytes = Buffer.from(signatureHex, 'hex');
    if (signatureBytes.length !== 64) {
        throw new Error('Invalid signature length. Expected 64 bytes (R+S)');
    }

    const r = signatureBytes.slice(0, 32);
    const s = signatureBytes.slice(32, 64);

    // Hash the message
    const messageHash = sha256(new TextEncoder().encode(message));
    console.log('📊 Message Hash:', Buffer.from(messageHash).toString('hex'));
    console.log('');

    // Try all 4 possible recovery values (0, 1, 2, 3)
    console.log('🔍 Trying all recovery values:\n');

    for (let recovery = 0; recovery <= 3; recovery++) {
        try {
            // Create new signature from the original signature components
            const rBigInt = BigInt('0x' + Buffer.from(r).toString('hex'));
            const sBigInt = BigInt('0x' + Buffer.from(s).toString('hex'));

            // Create signature object with addRecoveryBit method
            const sig = new secp256k1.Signature(rBigInt, sBigInt);
            const sigWithRecovery = sig.addRecoveryBit(recovery);

            // Recover the public key
            const recoveredPubKey = sigWithRecovery.recoverPublicKey(messageHash);
            const recoveredPubKeyBytes = recoveredPubKey.toRawBytes(true); // compressed
            const recoveredPubKeyHex = Buffer.from(recoveredPubKeyBytes).toString('hex');

            // Generate Spark address from recovered public key
            const generatedAddress = encodeSparkAddress(recoveredPubKeyBytes, sparkAddress.startsWith('spt') ? 'testnet' : 'mainnet');

            console.log(`Recovery ${recovery}:`);
            console.log(`  Recovered Public Key: ${recoveredPubKeyHex}`);
            console.log(`  Generated Address:    ${generatedAddress}`);
            console.log(`  Matches Target:       ${generatedAddress === sparkAddress ? '✅ YES!' : '❌ No'}`);

            // Verify the signature with this public key
            const isValid = secp256k1.verify(signatureHex, messageHash, recoveredPubKeyBytes);
            console.log(`  Signature Valid:      ${isValid ? '✅' : '❌'}`);

            if (generatedAddress === sparkAddress && isValid) {
                console.log('\n🎉 SUCCESS! Found matching public key and valid signature!');
                console.log('\n📋 Result:');
                console.log('  Correct Recovery Bit:', recovery);
                console.log('  Public Key:', recoveredPubKeyHex);
                console.log('  Spark Address:', sparkAddress);
                console.log('  Signature is VALID ✅');

                return {
                    valid: true,
                    recovery: recovery,
                    publicKey: recoveredPubKeyHex,
                    address: sparkAddress
                };
            }

            console.log('');
        } catch (error) {
            console.log(`Recovery ${recovery}: Failed - ${error.message}\n`);
        }
    }

    console.log('❌ FAILED: No recovery value produced a matching address');
    return {
        valid: false,
        error: 'Could not recover public key that matches the given Spark address'
    };
}

/**
 * Encode a public key as a Spark address
 */
function encodeSparkAddress(publicKey, network = 'mainnet') {
    const SPARK_PREFIXES = {
        mainnet: 'sp',
        testnet: 'spt'
    };

    const prefix = SPARK_PREFIXES[network];
    const words = bech32m.toWords(publicKey);
    return bech32m.encode(prefix, words, 1024);
}

/**
 * Main test function
 */
function runVerificationTest() {
    console.log('=== Testing Signature Verification Without Recovery Bit ===\n');

    // Use the signed message from our previous example
    const testCases = [
        {
            message: "Hallo_Montag",
            signature: "993bd4ba86bf037948b31d7e70caacdd68d212310ffdcadb38f60e5c5ef975f51cad30d87db0d6f654c5344771f886715b5c2d4e84197dc16a7ebcbe15617e24",
            sparkAddress: "sp1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg",
            expectedRecovery: 1,
            expectedPublicKey: "033bac09a39b6deba4b83e98e4b0b70f86fb16ca72e101a7c05ae3e72d2aaa0834"
        }
    ];

    testCases.forEach((testCase, index) => {
        console.log(`\n📌 Test Case ${index + 1}:\n`);
        console.log('Expected Recovery:', testCase.expectedRecovery);
        console.log('Expected Public Key:', testCase.expectedPublicKey);
        console.log('\n' + '='.repeat(60) + '\n');

        const result = verifyWithoutRecoveryBit(
            testCase.message,
            testCase.signature,
            testCase.sparkAddress
        );

        console.log('\n' + '='.repeat(60));
        console.log('\n📊 Test Summary:');
        if (result.valid) {
            console.log('  ✅ Successfully verified signature without recovery bit!');
            console.log('  Found Recovery:', result.recovery);
            console.log('  Matches Expected:', result.recovery === testCase.expectedRecovery ? '✅' : '❌');
            console.log('  Public Key Matches:', result.publicKey === testCase.expectedPublicKey ? '✅' : '❌');
        } else {
            console.log('  ❌ Verification failed:', result.error);
        }
    });

    console.log('\n' + '='.repeat(60));
    console.log('\n💡 Conclusion:');
    console.log('We can successfully verify signatures using only:');
    console.log('  1. Message');
    console.log('  2. Signature (64 bytes, without recovery bit)');
    console.log('  3. Spark Address');
    console.log('\nThe verification process tries all 4 possible recovery values');
    console.log('and checks which one produces a public key that matches the address.');
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
    runVerificationTest();
}

export { verifyWithoutRecoveryBit, encodeSparkAddress };