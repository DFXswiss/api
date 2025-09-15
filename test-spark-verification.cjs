const { secp256k1 } = require('@noble/curves/secp256k1');
const { sha256 } = require('@noble/hashes/sha256');
const { bech32m } = require('@scure/base');

// Test data from our examples
const testData = {
  message: 'Hallo_Montag',
  address: 'sp1qva6czdrndk7hf9c86vwfv9hp7r0k9k2wtssrf7qtt37wtf24gyrg9qf0pg',
  signature: '993bd4ba86bf037948b31d7e70caacdd68d212310ffdcadb38f60e5c5ef975f51cad30d87db0d6f654c5344771f886715b5c2d4e84197dc16a7ebcbe15617e24',
  expectedPublicKey: '033bac09a39b6deba4b83e98e4b0b70f86fb16ca72e101a7c05ae3e72d2aaa0834'
};

function encodeSparkAddress(publicKey, network = 'mainnet') {
  const prefixes = {
    mainnet: 'sp',
    testnet: 'spt'
  };
  const prefix = prefixes[network];
  const words = bech32m.toWords(publicKey);
  return bech32m.encode(prefix, words, 1024);
}

function testVerification() {
  console.log('Testing Spark signature verification...\n');

  // Hash the message
  const messageHash = sha256(new TextEncoder().encode(testData.message));
  console.log('Message hash:', Buffer.from(messageHash).toString('hex'));

  // Parse signature
  const signatureBytes = Buffer.from(testData.signature, 'hex');
  const r = signatureBytes.slice(0, 32);
  const s = signatureBytes.slice(32, 64);

  let found = false;

  // Try all recovery values
  for (let recovery = 0; recovery <= 3; recovery++) {
    try {
      const rBigInt = BigInt('0x' + r.toString('hex'));
      const sBigInt = BigInt('0x' + s.toString('hex'));

      const sig = new secp256k1.Signature(rBigInt, sBigInt);
      const sigWithRecovery = sig.addRecoveryBit(recovery);

      const recoveredPubKey = sigWithRecovery.recoverPublicKey(messageHash);
      const recoveredPubKeyBytes = recoveredPubKey.toRawBytes(true);
      const recoveredPubKeyHex = Buffer.from(recoveredPubKeyBytes).toString('hex');

      const generatedAddress = encodeSparkAddress(recoveredPubKeyBytes, 'mainnet');

      console.log(`Recovery ${recovery}:`);
      console.log(`  Public key: ${recoveredPubKeyHex}`);
      console.log(`  Generated address: ${generatedAddress}`);
      console.log(`  Matches target: ${generatedAddress === testData.address}`);

      if (generatedAddress === testData.address) {
        // Verify signature
        const isValid = secp256k1.verify(
          Buffer.from(testData.signature, 'hex'),
          messageHash,
          recoveredPubKeyBytes
        );

        console.log(`  Signature valid: ${isValid}`);

        if (isValid) {
          console.log('\n✅ SUCCESS! Verification works correctly.');
          console.log(`  Recovery bit: ${recovery}`);
          console.log(`  Public key matches expected: ${recoveredPubKeyHex === testData.expectedPublicKey}`);
          found = true;
          break;
        }
      }
    } catch (error) {
      console.log(`Recovery ${recovery}: Error - ${error.message}`);
    }
  }

  if (!found) {
    console.log('\n❌ FAILED! Could not verify signature.');
  }

  return found;
}

// Run test
const success = testVerification();
process.exit(success ? 0 : 1);