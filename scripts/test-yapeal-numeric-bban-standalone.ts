/**
 * Standalone Test: Yapeal Numeric BBAN Support
 *
 * This script directly tests the Yapeal API without loading the full NestJS app.
 *
 * Usage:
 *   cd api && npx ts-node --transpile-only scripts/test-yapeal-numeric-bban-standalone.ts
 */

import axios from 'axios';
import * as https from 'https';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface VibanProposalResponse {
  bban: string;
  iban: string;
}

interface VibanAvailabilityResponse {
  bban: string;
  iban: string;
}

async function main() {
  console.log('='.repeat(60));
  console.log('YAPEAL NUMERIC BBAN TEST (Standalone)');
  console.log('='.repeat(60));
  console.log();

  // Read config from environment
  const baseUrl = process.env.YAPEAL_BASE_URL;
  const apiKey = process.env.YAPEAL_API_KEY;
  const partnershipUid = process.env.YAPEAL_PARTNERSHIP_UID;
  const certPath = process.env.YAPEAL_CERT;
  const keyPath = process.env.YAPEAL_KEY;
  const rootCaPath = process.env.YAPEAL_ROOT_CA;

  // Handle cert/key - could be path or inline content
  let cert = certPath;
  let key = keyPath;
  let rootCa = rootCaPath;

  // Replace <br> with newlines (common format in .env)
  if (cert) cert = cert.split('<br>').join('\n');
  if (key) key = key.split('<br>').join('\n');
  if (rootCa) rootCa = rootCa.split('<br>').join('\n');

  // Check config
  console.log('Configuration:');
  console.log(`  Base URL: ${baseUrl ? '✓ Set' : '✗ Missing'}`);
  console.log(`  API Key: ${apiKey ? '✓ Set' : '✗ Missing'}`);
  console.log(`  Partnership UID: ${partnershipUid ? '✓ Set' : '✗ Missing'}`);
  console.log(`  Certificate: ${cert ? '✓ Set' : '✗ Missing'}`);
  console.log(`  Key: ${key ? '✓ Set' : '✗ Missing'}`);
  console.log(`  Root CA: ${rootCa ? '✓ Set' : '⚠ Optional'}`);
  console.log();

  if (!baseUrl || !apiKey || !partnershipUid || !cert || !key) {
    console.error('❌ Missing required Yapeal configuration. Check your .env file.');
    console.log('\nRequired variables:');
    console.log('  YAPEAL_BASE_URL');
    console.log('  YAPEAL_API_KEY');
    console.log('  YAPEAL_PARTNERSHIP_UID');
    console.log('  YAPEAL_CERT');
    console.log('  YAPEAL_KEY');
    process.exit(1);
  }

  // Create HTTPS agent with certificates
  const httpsAgent = new https.Agent({
    cert,
    key,
    ...(rootCa && { ca: rootCa }),
  });

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };

  // Helper function to call Yapeal API
  async function callApi<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any): Promise<T> {
    const url = `${baseUrl}/${endpoint}`;
    try {
      const response = await axios({
        url,
        method,
        data,
        httpsAgent,
        headers,
      });
      return response.data;
    } catch (error: any) {
      const message = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error;
      throw new Error(`YAPEAL API error (${method} ${endpoint}): ${message}`);
    }
  }

  try {
    // Test 1: Get Yapeal's default proposal
    console.log('TEST 1: Get Yapeal\'s default vIBAN proposal');
    console.log('-'.repeat(40));

    const proposal = await callApi<VibanProposalResponse>(
      `b2b/v2/partnerships/${partnershipUid}/viban/proposal`
    );

    console.log('Yapeal Proposal:');
    console.log(`  BBAN: ${proposal.bban}`);
    console.log(`  IBAN: ${proposal.iban}`);
    console.log(`  Contains letters: ${/[a-zA-Z]/.test(proposal.bban) ? 'YES ← Contains DFXAG or similar' : 'NO'}`);
    console.log();

    // Test 2: Check numeric BBAN availability
    console.log('TEST 2: Check numeric BBAN availability');
    console.log('-'.repeat(40));

    const testPatterns = [
      '000000000001',
      '123456789012',
      '999999999999',
      String(Math.floor(Math.random() * 1e12)).padStart(12, '0'), // Random
    ];

    let anyNumericWorked = false;

    for (const bban of testPatterns) {
      try {
        const availability = await callApi<VibanAvailabilityResponse>(
          `b2b/v2/partnerships/viban/availability?bban=${encodeURIComponent(bban)}`
        );
        console.log(`  ${bban}: ✓ Available → ${availability.iban}`);
        anyNumericWorked = true;
      } catch (error: any) {
        const msg = error?.message || String(error);
        // Extract just the error message, not the full stack
        const shortMsg = msg.includes('YAPEAL API error')
          ? msg.split('YAPEAL API error')[1].substring(0, 80)
          : msg.substring(0, 80);
        console.log(`  ${bban}: ✗ ${shortMsg}...`);
      }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('RESULT');
    console.log('='.repeat(60));

    if (anyNumericWorked) {
      console.log('\n🎉 ERFOLG: Yapeal akzeptiert rein numerische BBans!');
      console.log('   Du kannst createViban() anpassen um numerische BBans zu verwenden.\n');
    } else {
      console.log('\n⚠️  Yapeal scheint einen spezifischen BBAN-Format zu erfordern.');
      console.log(`   Der vorgeschlagene BBAN ist: ${proposal.bban}`);
      console.log('   Kontaktiere Yapeal Support für Klärung.\n');
    }

  } catch (error) {
    console.error('\n❌ Test fehlgeschlagen:', error);
    process.exit(1);
  }
}

main().catch(console.error);
