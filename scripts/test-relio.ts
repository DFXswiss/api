/**
 * Relio API Integration Test
 *
 * Run with: npx ts-node scripts/test-relio.ts
 *
 * Reads configuration from .env file automatically.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

// Load .env file manually (to avoid dotenv dependency issues)
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        const value = trimmed.substring(eqIndex + 1);
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

// Configuration from environment
const config = {
  baseUrl: process.env.RELIO_BASE_URL,
  apiKey: process.env.RELIO_API_KEY,
  privateKey: process.env.RELIO_PRIVATE_KEY?.split('<br>').join('\n'),
  organizationId: process.env.RELIO_ORGANIZATION_ID,
};

// Initialize private key
let privateKey: crypto.KeyObject | undefined;
try {
  if (config.privateKey) {
    privateKey = crypto.createPrivateKey({
      key: config.privateKey,
      format: 'pem',
      type: 'pkcs8',
    });
  }
} catch (e) {
  console.error('Failed to load private key:', e);
}

// Signing functions (same as in RelioService)
function buildCanonicalBody(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'object') {
    if (Array.isArray(body)) return JSON.stringify(body);
    const obj = body as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sortedObj[key] = obj[key];
    }
    return JSON.stringify(sortedObj);
  }
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function createCanonicalString(method: string, originalUrl: string, body?: unknown): string {
  return `${method.toUpperCase()}${originalUrl}${buildCanonicalBody(body)}`;
}

function signRequest(canonicalString: string): string {
  if (!privateKey) throw new Error('Private key not initialized');
  const signature = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), privateKey);
  return signature.toString('base64');
}

async function callApi<T>(endpoint: string, method: string = 'GET', data?: unknown): Promise<T> {
  const [pathPart, queryPart] = endpoint.split('?');
  const originalUrl = `/v1/${pathPart}${queryPart ? '?' + queryPart : ''}`;
  const canonicalString = createCanonicalString(method, originalUrl, data);
  const signature = signRequest(canonicalString);

  console.log('\n--- Request Details ---');
  console.log('Endpoint:', endpoint);
  console.log('Method:', method);
  console.log('Original URL (for signing):', originalUrl);
  console.log(
    'Canonical String:',
    canonicalString.length > 100 ? canonicalString.substring(0, 100) + '...' : canonicalString,
  );
  console.log('Signature:', signature.substring(0, 50) + '...');

  const response = await axios({
    url: `${config.baseUrl}/${endpoint}`,
    method: method as any,
    data,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'x-signature': signature,
    },
  });

  return response.data;
}

// Test functions
async function testAuthContext(): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: GET /v1/auth/context');
  console.log('='.repeat(60));

  try {
    const result = await callApi('auth/context', 'GET');
    console.log('\n✓ SUCCESS!');
    console.log('Response:', JSON.stringify(result, null, 2));
    return true;
  } catch (error: any) {
    console.log('\n✗ FAILED!');
    console.log('Error:', error.response?.data || error.message);
    return false;
  }
}

async function testGetAccounts(): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: GET /v1/accounts');
  console.log('='.repeat(60));

  try {
    const result = await callApi('accounts?pageNumber=1&pageSize=10', 'GET');
    console.log('\n✓ SUCCESS!');
    console.log('Response:', JSON.stringify(result, null, 2));
    return true;
  } catch (error: any) {
    console.log('\n✗ FAILED!');
    console.log('Error:', error.response?.data || error.message);
    return false;
  }
}

async function testGetWallets(): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: GET /v1/wallets');
  console.log('='.repeat(60));

  try {
    const result = await callApi('wallets?pageNumber=1&pageSize=10', 'GET');
    console.log('\n✓ SUCCESS!');
    console.log('Response:', JSON.stringify(result, null, 2));
    return true;
  } catch (error: any) {
    console.log('\n✗ FAILED!');
    console.log('Error:', error.response?.data || error.message);
    return false;
  }
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('RELIO API INTEGRATION TEST');
  console.log('='.repeat(60));

  // Check configuration
  console.log('\nConfiguration:');
  console.log('  Base URL:', config.baseUrl || 'MISSING');
  console.log('  API Key:', config.apiKey ? 'Loaded' : 'MISSING');
  console.log('  Private Key:', privateKey ? 'Loaded' : 'MISSING or INVALID');
  console.log('  Organization ID:', config.organizationId || 'MISSING');

  if (!config.baseUrl || !config.apiKey || !privateKey || !config.organizationId) {
    console.log('\nMissing required configuration. Please set environment variables:');
    console.log('   RELIO_BASE_URL=https://api.develio.ch/v1');
    console.log('   RELIO_API_KEY=<your-api-key>');
    console.log('   RELIO_PRIVATE_KEY=<your-private-key-pem>');
    console.log('   RELIO_ORGANIZATION_ID=<your-org-id>');
    process.exit(1);
  }

  // Run tests
  const results: boolean[] = [];

  results.push(await testAuthContext());
  results.push(await testGetAccounts());
  results.push(await testGetWallets());

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  const passed = results.filter((r) => r).length;
  const failed = results.filter((r) => !r).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nSome tests failed. Check the errors above.');
    process.exit(1);
  } else {
    console.log('\nAll tests passed! The Relio integration is working correctly.');
  }
}

main().catch(console.error);
