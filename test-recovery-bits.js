import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

const EXAMPLE_MNEMONIC = "flush fiscal rib invest then magic include frame balcony aerobic smile host laugh dune cannon praise circle ghost make mercy bid bounce file purchase";

function testRecoveryBits() {
    console.log('=== Testing Recovery Bit Variability ===\n');

    const seed = mnemonicToSeedSync(EXAMPLE_MNEMONIC);
    const hdWallet = HDKey.fromMasterSeed(seed);
    const account0 = hdWallet.derive("m/44'/0'/0'/0/0");
    const privateKey = Buffer.from(account0.privateKey);

    // Test with multiple different messages
    const messages = [
        "Hallo_Montag",
        "Hallo_Dienstag",
        "Hallo_Mittwoch",
        "Hallo_Donnerstag",
        "Hallo_Freitag",
        "Test123",
        "A",
        "AAAAAAAAAA",
        "1234567890",
        "Bitcoin"
    ];

    console.log('Signing 10 different messages to check recovery bits:\n');

    const recoveryStats = { 0: 0, 1: 0, 2: 0, 3: 0 };

    messages.forEach(message => {
        const messageHash = sha256(new TextEncoder().encode(message));
        const signature = secp256k1.sign(messageHash, privateKey);

        recoveryStats[signature.recovery]++;

        console.log(`Message: "${message.padEnd(20)}" → Recovery: ${signature.recovery}`);
    });

    console.log('\n📊 Recovery Bit Distribution:');
    console.log(`  Recovery 0: ${recoveryStats[0]} times (${(recoveryStats[0]/10*100).toFixed(0)}%)`);
    console.log(`  Recovery 1: ${recoveryStats[1]} times (${(recoveryStats[1]/10*100).toFixed(0)}%)`);
    console.log(`  Recovery 2: ${recoveryStats[2]} times`);
    console.log(`  Recovery 3: ${recoveryStats[3]} times`);

    // Now test signing the SAME message multiple times
    console.log('\n=== Signing Same Message Multiple Times (Deterministic) ===\n');

    const testMessage = "Hallo_Montag";
    const testHash = sha256(new TextEncoder().encode(testMessage));

    console.log('Note: secp256k1 from @noble/curves uses RFC 6979 (deterministic signatures)\n');

    for (let i = 0; i < 5; i++) {
        const sig = secp256k1.sign(testHash, privateKey);
        console.log(`Attempt ${i+1}: Recovery = ${sig.recovery}, R = ${sig.r.toString(16).substring(0, 16)}...`);
    }

    console.log('\n💡 Conclusion:');
    console.log('- Recovery bit varies based on the message being signed');
    console.log('- For the same message, it\'s deterministic (RFC 6979)');
    console.log('- Cannot assume recovery is always 1!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    testRecoveryBits();
}

export { testRecoveryBits };