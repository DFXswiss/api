/* eslint-disable */
/**
 * Scorechain smoke test — validates API key, endpoints and the response-signature
 * (proof of authenticity) against the real Scorechain API using the official SDK verifier.
 * Run manually, NOT part of CI. Consumes ~1 check.
 *
 * Usage:
 *   1. Put SCORECHAIN_API_KEY=... in the api repo .env (gitignored).
 *   2. node scripts/scorechain-smoke.js [blockchain] [address]
 *      defaults: ETHEREUM  0x0000000000000000000000000000000000000000
 */
const axios = require('axios');
const { proofOfAuthenticityVerifier } = require('scorechain-sdk');
require('dotenv').config();

const BASE = process.env.SCORECHAIN_API_URL || 'https://api.scorechain.com/v1';
const API_KEY = process.env.SCORECHAIN_API_KEY;

const blockchain = process.argv[2] || 'ETHEREUM';
const address = process.argv[3] || '0x0000000000000000000000000000000000000000';

async function main() {
  if (!API_KEY) {
    console.error('✗ SCORECHAIN_API_KEY not set in .env — generate it in the Scorechain workspace first.');
    process.exit(1);
  }
  const http = axios.create({ baseURL: BASE, headers: { 'X-API-KEY': API_KEY } });

  // 1) public key (validates the key works; needed to verify signatures)
  const publicKey = (await http.get('/publicKeys')).data?.[0]?.key;
  console.log(`✓ GET /publicKeys → ${publicKey ? 'key received' : 'KEY MISSING'}`);

  // 2) scoring analysis (the real screening call)
  const body = { objectType: 'ADDRESS', objectId: address, blockchain, analysisType: 'ASSIGNED' };
  const res = await http.post('/scoringAnalysis', body);
  console.log(`✓ POST /scoringAnalysis → ${res.status} · lowestScore: ${res.data.lowestScore}`);

  // 3) proof of authenticity via the official SDK verifier (throws on failure)
  proofOfAuthenticityVerifier(res.data, res.headers['x-signature'], publicKey, res.headers['x-server-time']);
  console.log('✓ signature verified (proof of authenticity)');

  console.log('\n✓ Smoke test passed.');
}

main().catch((e) => {
  const status = e.response?.status;
  console.error(`✗ Failed${status ? ` (HTTP ${status})` : ''}: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
  process.exit(1);
});
