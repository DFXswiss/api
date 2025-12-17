/**
 * Test Script: Yapeal Numeric BBAN Support
 *
 * This script tests whether Yapeal accepts purely numeric BBans for vIBAN creation.
 *
 * Usage:
 *   npx ts-node scripts/test-yapeal-numeric-bban.ts
 *
 * Or with env-cmd for specific environment:
 *   npx env-cmd -f .env.dev npx ts-node scripts/test-yapeal-numeric-bban.ts
 *
 * Expected results:
 * - If numeric BBans are supported: availability check returns { bban, iban }
 * - If not supported: API returns an error (likely 400 or 422)
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { YapealService } from '../src/integration/bank/services/yapeal.service';

async function testNumericBban() {
  console.log('='.repeat(60));
  console.log('YAPEAL NUMERIC BBAN TEST');
  console.log('='.repeat(60));
  console.log();

  // Bootstrap minimal NestJS app to get configured services
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const yapealService = app.get(YapealService);

  if (!yapealService.isAvailable()) {
    console.error('❌ Yapeal is not configured. Check your environment variables.');
    await app.close();
    process.exit(1);
  }

  console.log('✓ Yapeal service is available\n');

  try {
    // Test 1: Get Yapeal's default proposal
    console.log('TEST 1: Get Yapeal\'s default vIBAN proposal');
    console.log('-'.repeat(40));
    const result = await yapealService.testNumericBbanSupport();

    console.log('Yapeal Proposal:');
    console.log(`  BBAN: ${result.yapealProposal.bban}`);
    console.log(`  IBAN: ${result.yapealProposal.iban}`);
    console.log(`  Contains letters: ${/[a-zA-Z]/.test(result.yapealProposal.bban) ? 'YES' : 'NO'}`);
    console.log();

    // Test 2: Check numeric BBAN availability
    console.log('TEST 2: Check numeric BBAN availability');
    console.log('-'.repeat(40));
    console.log(`Tested BBAN: ${result.numericAvailability.bban}`);

    if (result.numericAvailability.available) {
      console.log('✓ NUMERIC BBAN IS SUPPORTED!');
      console.log(`  Result IBAN: ${result.numericAvailability.result?.iban}`);
    } else {
      console.log('✗ Numeric BBAN not available or not supported');
      console.log(`  Error: ${result.numericAvailability.error}`);
    }
    console.log();

    // Test 3: Try specific numeric patterns
    console.log('TEST 3: Test specific numeric patterns');
    console.log('-'.repeat(40));

    const testPatterns = [
      '000000000001', // Sequential
      '123456789012', // All digits
      '999999999999', // All 9s
      '100000000000', // Leading 1
    ];

    for (const pattern of testPatterns) {
      try {
        const availability = await yapealService.checkVibanAvailability(pattern);
        console.log(`  ${pattern}: ✓ Available → ${availability.iban}`);
      } catch (error) {
        const msg = error?.message || String(error);
        const shortMsg = msg.length > 60 ? msg.substring(0, 60) + '...' : msg;
        console.log(`  ${pattern}: ✗ ${shortMsg}`);
      }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

    if (result.numericAvailability.available) {
      console.log('\n🎉 GOOD NEWS: Yapeal accepts numeric-only BBans!');
      console.log('   You can modify createViban() to use numeric BBans.\n');
    } else {
      console.log('\n⚠️  Yapeal may require a specific BBAN format.');
      console.log('   Contact Yapeal support to clarify BBAN requirements.\n');
    }
  } catch (error) {
    console.error('Test failed with error:', error);
  }

  await app.close();
}

testNumericBban().catch(console.error);
