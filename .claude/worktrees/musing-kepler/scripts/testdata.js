const mssql = require('mssql');
const crypto = require('crypto');

// Safety check - only local
const dbHost = process.env.SQL_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost)) {
  console.error('This script only runs on localhost!');
  process.exit(1);
}

const config = {
  user: process.env.SQL_USERNAME || 'sa',
  password: process.env.SQL_PASSWORD || 'LocalDev2026@SQL',
  server: 'localhost',
  port: parseInt(process.env.SQL_PORT) || 1433,
  database: process.env.SQL_DB || 'dfx',
  options: { encrypt: false, trustServerCertificate: true },
};

// Test addresses (not real wallets)
const TEST_ADDRESSES = {
  EVM: [
    '0xTestUser2000000000000000000000000000002',
    '0xTestUser3000000000000000000000000000003',
    '0xTestUser4000000000000000000000000000004',
    '0xTestUser5000000000000000000000000000005',
  ],
  BITCOIN: ['bc1qTestBtcUser2000000000000000000002', 'bc1qTestBtcUser3000000000000000000003'],
};

function uuid() {
  return crypto.randomUUID().toUpperCase();
}

function bankUsage() {
  const chars = 'ABCDEF0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) result += '-';
    result += chars[crypto.randomInt(chars.length)];
  }
  return result;
}

async function main() {
  console.log('Connecting to database...');
  const pool = await mssql.connect(config);

  console.log('Creating test data...\n');

  // Get existing IDs for foreign keys
  const walletResult = await pool.request().query('SELECT TOP 1 id FROM wallet');
  const walletId = walletResult.recordset[0]?.id || 1;

  const langResult = await pool.request().query("SELECT id FROM language WHERE symbol = 'EN'");
  const languageId = langResult.recordset[0]?.id || 1;

  const chfResult = await pool.request().query("SELECT id FROM fiat WHERE name = 'CHF'");
  const chfId = chfResult.recordset[0]?.id || 1;

  const eurResult = await pool.request().query("SELECT id FROM fiat WHERE name = 'EUR'");
  const eurId = eurResult.recordset[0]?.id || 2;

  const countryResult = await pool.request().query("SELECT id FROM country WHERE symbol = 'CH'");
  const countryId = countryResult.recordset[0]?.id || 1;

  const deCountryResult = await pool.request().query("SELECT id FROM country WHERE symbol = 'DE'");
  const deCountryId = deCountryResult.recordset[0]?.id || 2;

  // Get some assets
  const btcResult = await pool.request().query("SELECT id FROM asset WHERE name = 'BTC' AND blockchain = 'Bitcoin'");
  const btcId = btcResult.recordset[0]?.id;

  const ethResult = await pool.request().query("SELECT id FROM asset WHERE name = 'ETH' AND blockchain = 'Ethereum'");
  const ethId = ethResult.recordset[0]?.id;

  const usdtResult = await pool.request().query("SELECT id FROM asset WHERE name = 'USDT' AND blockchain = 'Ethereum'");
  const usdtId = usdtResult.recordset[0]?.id;

  console.log(`Using: walletId=${walletId}, langId=${languageId}, chfId=${chfId}, eurId=${eurId}`);
  console.log(`Assets: BTC=${btcId}, ETH=${ethId}, USDT=${usdtId}\n`);

  // ============================================================
  // Create UserData entries
  // ============================================================
  console.log('Creating UserData entries...');

  const userDataConfigs = [
    {
      mail: 'kyc0@test.local',
      kycLevel: 0,
      kycStatus: 'NA',
      status: 'Active',
      firstname: 'Test',
      surname: 'NoKYC',
      countryId,
    },
    {
      mail: 'kyc10@test.local',
      kycLevel: 10,
      kycStatus: 'NA',
      status: 'Active',
      firstname: 'Hans',
      surname: 'Muster',
      countryId,
      birthday: '1985-03-15',
      street: 'Bahnhofstrasse',
      houseNumber: '12',
      zip: '8001',
      location: 'Zürich',
    },
    {
      mail: 'kyc20@test.local',
      kycLevel: 20,
      kycStatus: 'NA',
      status: 'Active',
      firstname: 'Anna',
      surname: 'Schmidt',
      countryId: deCountryId,
      birthday: '1990-07-22',
      street: 'Hauptstrasse',
      houseNumber: '45a',
      zip: '10115',
      location: 'Berlin',
    },
    {
      mail: 'kyc30@test.local',
      kycLevel: 30,
      kycStatus: 'Completed',
      status: 'Active',
      firstname: 'Max',
      surname: 'Mueller',
      countryId,
      birthday: '1978-11-30',
      accountType: 'Personal',
      street: 'Limmatquai',
      houseNumber: '78',
      zip: '8001',
      location: 'Zürich',
    },
    {
      mail: 'kyc50@test.local',
      kycLevel: 50,
      kycStatus: 'Completed',
      status: 'Active',
      firstname: 'Lisa',
      surname: 'Weber',
      countryId,
      birthday: '1982-05-10',
      accountType: 'Personal',
      street: 'Paradeplatz',
      houseNumber: '1',
      zip: '8001',
      location: 'Zürich',
    },
  ];

  const userDataIds = [];
  for (const ud of userDataConfigs) {
    const existing = await pool
      .request()
      .input('mail', mssql.NVarChar, ud.mail)
      .query('SELECT id FROM user_data WHERE mail = @mail');

    if (existing.recordset.length > 0) {
      userDataIds.push(existing.recordset[0].id);
      console.log(`  UserData ${ud.mail} already exists (id=${existing.recordset[0].id})`);
      continue;
    }

    const kycHash = uuid();
    const result = await pool
      .request()
      .input('mail', mssql.NVarChar, ud.mail)
      .input('firstname', mssql.NVarChar, ud.firstname)
      .input('surname', mssql.NVarChar, ud.surname)
      .input('street', mssql.NVarChar, ud.street || null)
      .input('houseNumber', mssql.NVarChar, ud.houseNumber || null)
      .input('zip', mssql.NVarChar, ud.zip || null)
      .input('location', mssql.NVarChar, ud.location || null)
      .input('kycHash', mssql.NVarChar, kycHash)
      .input('kycLevel', mssql.Int, ud.kycLevel)
      .input('kycStatus', mssql.NVarChar, ud.kycStatus)
      .input('kycType', mssql.NVarChar, 'DFX')
      .input('status', mssql.NVarChar, ud.status)
      .input('riskStatus', mssql.NVarChar, 'NA')
      .input('countryId', mssql.Int, ud.countryId || null)
      .input('nationalityId', mssql.Int, ud.countryId || null)
      .input('languageId', mssql.Int, languageId)
      .input('currencyId', mssql.Int, chfId)
      .input('walletId', mssql.Int, walletId)
      .input('accountType', mssql.NVarChar, ud.accountType || null)
      .input('birthday', mssql.Date, ud.birthday || null).query(`
        INSERT INTO user_data (mail, firstname, surname, street, houseNumber, zip, location, kycHash, kycLevel, kycStatus, kycType, status, riskStatus,
          countryId, nationalityId, languageId, currencyId, walletId, accountType, birthday, created, updated)
        OUTPUT INSERTED.id
        VALUES (@mail, @firstname, @surname, @street, @houseNumber, @zip, @location, @kycHash, @kycLevel, @kycStatus, @kycType, @status, @riskStatus,
          @countryId, @nationalityId, @languageId, @currencyId, @walletId, @accountType, @birthday, GETUTCDATE(), GETUTCDATE())
      `);

    userDataIds.push(result.recordset[0].id);
    console.log(`  Created UserData: ${ud.mail} (id=${result.recordset[0].id}, kycLevel=${ud.kycLevel})`);
  }

  // ============================================================
  // Create Users
  // ============================================================
  console.log('\nCreating Users...');

  const userConfigs = [
    { address: TEST_ADDRESSES.EVM[0], addressType: 'EVM', role: 'User', userDataIdx: 0 },
    { address: TEST_ADDRESSES.EVM[1], addressType: 'EVM', role: 'User', userDataIdx: 1 },
    { address: TEST_ADDRESSES.EVM[2], addressType: 'EVM', role: 'User', userDataIdx: 2 },
    { address: TEST_ADDRESSES.EVM[3], addressType: 'EVM', role: 'VIP', userDataIdx: 3 },
    { address: TEST_ADDRESSES.BITCOIN[0], addressType: 'Bitcoin', role: 'User', userDataIdx: 4 },
  ];

  const userIds = [];
  for (const u of userConfigs) {
    const existing = await pool
      .request()
      .input('address', mssql.NVarChar, u.address)
      .query('SELECT id FROM [user] WHERE address = @address');

    if (existing.recordset.length > 0) {
      userIds.push(existing.recordset[0].id);
      console.log(`  User ${u.address.substring(0, 20)}... already exists (id=${existing.recordset[0].id})`);
      continue;
    }

    const result = await pool
      .request()
      .input('address', mssql.NVarChar, u.address)
      .input('addressType', mssql.NVarChar, u.addressType)
      .input('role', mssql.NVarChar, u.role)
      .input('status', mssql.NVarChar, 'Active')
      .input('usedRef', mssql.NVarChar, '000-000')
      .input('walletId', mssql.Int, walletId)
      .input('userDataId', mssql.Int, userDataIds[u.userDataIdx])
      .input('refFeePercent', mssql.Float, 0.25).query(`
        INSERT INTO [user] (address, addressType, role, status, usedRef, walletId, userDataId, refFeePercent,
          buyVolume, annualBuyVolume, monthlyBuyVolume, sellVolume, annualSellVolume, monthlySellVolume,
          cryptoVolume, annualCryptoVolume, monthlyCryptoVolume, refVolume, refCredit, paidRefCredit, created, updated)
        OUTPUT INSERTED.id
        VALUES (@address, @addressType, @role, @status, @usedRef, @walletId, @userDataId, @refFeePercent,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, GETUTCDATE(), GETUTCDATE())
      `);

    userIds.push(result.recordset[0].id);
    console.log(`  Created User: ${u.address.substring(0, 20)}... (id=${result.recordset[0].id}, role=${u.role})`);
  }

  // ============================================================
  // Create Routes (for Buy entities)
  // ============================================================
  console.log('\nCreating Routes...');

  const routeIds = [];
  for (let i = 0; i < 4; i++) {
    const result = await pool.request().input('label', mssql.NVarChar, `TestRoute${i + 2}`).query(`
        INSERT INTO route (label, created, updated)
        OUTPUT INSERTED.id
        VALUES (@label, GETUTCDATE(), GETUTCDATE())
      `);
    routeIds.push(result.recordset[0].id);
  }
  console.log(`  Created ${routeIds.length} routes`);

  // ============================================================
  // Create Buy routes
  // ============================================================
  console.log('\nCreating Buy routes...');

  const buyConfigs = [
    { userId: userIds[0], assetId: btcId },
    { userId: userIds[0], assetId: ethId },
    { userId: userIds[1], assetId: btcId },
    { userId: userIds[2], assetId: usdtId },
  ];

  for (let i = 0; i < buyConfigs.length; i++) {
    const b = buyConfigs[i];
    if (!b.assetId) continue;

    const usage = bankUsage();
    const existing = await pool
      .request()
      .input('userId', mssql.Int, b.userId)
      .input('assetId', mssql.Int, b.assetId)
      .query('SELECT id FROM buy WHERE userId = @userId AND assetId = @assetId');

    if (existing.recordset.length > 0) {
      console.log(`  Buy route for user ${b.userId}, asset ${b.assetId} already exists`);
      continue;
    }

    await pool
      .request()
      .input('bankUsage', mssql.NVarChar, usage)
      .input('userId', mssql.Int, b.userId)
      .input('assetId', mssql.Int, b.assetId)
      .input('routeId', mssql.Int, routeIds[i])
      .input('active', mssql.Bit, true).query(`
        INSERT INTO buy (bankUsage, userId, assetId, routeId, active, volume, annualVolume, monthlyVolume, created, updated)
        VALUES (@bankUsage, @userId, @assetId, @routeId, @active, 0, 0, 0, GETUTCDATE(), GETUTCDATE())
      `);

    console.log(`  Created Buy route: user=${b.userId}, asset=${b.assetId}, usage=${usage}`);
  }

  // ============================================================
  // Create BankData entries
  // ============================================================
  console.log('\nCreating BankData entries...');

  const bankDataConfigs = [
    { userDataId: userDataIds[2], iban: 'CH93 0076 2011 6238 5295 7', name: 'Anna Schmidt' },
    { userDataId: userDataIds[3], iban: 'DE89 3704 0044 0532 0130 00', name: 'Max Mueller' },
    { userDataId: userDataIds[4], iban: 'CH56 0483 5012 3456 7800 9', name: 'Lisa Weber' },
  ];

  const bankDataIds = [];
  for (const bd of bankDataConfigs) {
    const cleanIban = bd.iban.replace(/\s/g, '');
    const existing = await pool
      .request()
      .input('iban', mssql.NVarChar, cleanIban)
      .query('SELECT id FROM bank_data WHERE iban = @iban');

    if (existing.recordset.length > 0) {
      bankDataIds.push(existing.recordset[0].id);
      console.log(`  BankData ${cleanIban} already exists`);
      continue;
    }

    const result = await pool
      .request()
      .input('iban', mssql.NVarChar, cleanIban)
      .input('name', mssql.NVarChar, bd.name)
      .input('userDataId', mssql.Int, bd.userDataId)
      .input('approved', mssql.Bit, true).query(`
        INSERT INTO bank_data (iban, name, userDataId, approved, created, updated)
        OUTPUT INSERTED.id
        VALUES (@iban, @name, @userDataId, @approved, GETUTCDATE(), GETUTCDATE())
      `);

    bankDataIds.push(result.recordset[0].id);
    console.log(`  Created BankData: ${cleanIban}`);
  }

  // ============================================================
  // Create Deposits (crypto addresses)
  // ============================================================
  console.log('\nCreating Deposit addresses...');

  const depositConfigs = [
    { address: '0xDeposit000000000000000000000000000001', blockchains: 'Ethereum;Arbitrum;Optimism;Polygon;Base' },
    { address: '0xDeposit000000000000000000000000000002', blockchains: 'Ethereum;Arbitrum;Optimism;Polygon;Base' },
    { address: 'bc1qdeposit0000000000000000000001', blockchains: 'Bitcoin' },
  ];

  for (const d of depositConfigs) {
    const existing = await pool
      .request()
      .input('address', mssql.NVarChar, d.address)
      .query('SELECT id FROM deposit WHERE address = @address');

    if (existing.recordset.length > 0) {
      console.log(`  Deposit ${d.address.substring(0, 25)}... already exists`);
      continue;
    }

    await pool.request().input('address', mssql.NVarChar, d.address).input('blockchains', mssql.NVarChar, d.blockchains)
      .query(`
        INSERT INTO deposit (address, blockchains, created, updated)
        VALUES (@address, @blockchains, GETUTCDATE(), GETUTCDATE())
      `);

    console.log(`  Created Deposit: ${d.address.substring(0, 25)}...`);
  }

  // ============================================================
  // Create Transactions
  // ============================================================
  console.log('\nCreating Transaction entries...');

  const txConfigs = [
    { userId: userIds[0], userDataId: userDataIds[0], sourceType: 'BuyCrypto', amountInChf: 500, amlCheck: 'Pass' },
    { userId: userIds[0], userDataId: userDataIds[0], sourceType: 'BuyCrypto', amountInChf: 1200, amlCheck: 'Pass' },
    { userId: userIds[1], userDataId: userDataIds[1], sourceType: 'BuyCrypto', amountInChf: 2500, amlCheck: 'Pass' },
    { userId: userIds[2], userDataId: userDataIds[2], sourceType: 'BuyFiat', amountInChf: 800, amlCheck: 'Pass' },
    { userId: userIds[3], userDataId: userDataIds[3], sourceType: 'BuyCrypto', amountInChf: 5000, amlCheck: 'Pass' },
    { userId: userIds[3], userDataId: userDataIds[3], sourceType: 'BuyFiat', amountInChf: 3500, amlCheck: 'Pass' },
  ];

  for (const tx of txConfigs) {
    const uid = uuid();

    await pool
      .request()
      .input('uid', mssql.NVarChar, uid)
      .input('sourceType', mssql.NVarChar, tx.sourceType)
      .input('userId', mssql.Int, tx.userId)
      .input('userDataId', mssql.Int, tx.userDataId)
      .input('amountInChf', mssql.Float, tx.amountInChf)
      .input('amlCheck', mssql.NVarChar, tx.amlCheck)
      .input('eventDate', mssql.DateTime2, new Date()).query(`
        INSERT INTO [transaction] (uid, sourceType, userId, userDataId, amountInChf, amlCheck, eventDate, created, updated)
        VALUES (@uid, @sourceType, @userId, @userDataId, @amountInChf, @amlCheck, @eventDate, GETUTCDATE(), GETUTCDATE())
      `);

    console.log(`  Created Transaction: ${tx.sourceType}, CHF ${tx.amountInChf}, user=${tx.userId}`);
  }

  // ============================================================
  // Create BankTx entries (incoming bank transfers)
  // ============================================================
  console.log('\nCreating BankTx entries...');

  const bankResult = await pool.request().query('SELECT TOP 1 id FROM bank WHERE receive = 1');
  const bankId = bankResult.recordset[0]?.id;

  if (bankId) {
    const bankTxConfigs = [
      { accountIban: 'CH9300762011623852957', name: 'Anna Schmidt', amount: 500, currency: 'CHF', type: 'BuyCrypto' },
      { accountIban: 'DE89370400440532013000', name: 'Max Mueller', amount: 1000, currency: 'EUR', type: 'BuyCrypto' },
      { accountIban: 'CH5604835012345678009', name: 'Lisa Weber', amount: 2000, currency: 'CHF', type: 'BuyCrypto' },
    ];

    for (const btx of bankTxConfigs) {
      await pool
        .request()
        .input('bankId', mssql.Int, bankId)
        .input('accountIban', mssql.NVarChar, btx.accountIban)
        .input('name', mssql.NVarChar, btx.name)
        .input('amount', mssql.Float, btx.amount)
        .input('currency', mssql.NVarChar, btx.currency)
        .input('type', mssql.NVarChar, btx.type)
        .input('creditDebitIndicator', mssql.NVarChar, 'CRDT').query(`
          INSERT INTO bank_tx (bankId, accountIban, name, amount, currency, type, creditDebitIndicator, created, updated)
          VALUES (@bankId, @accountIban, @name, @amount, @currency, @type, @creditDebitIndicator, GETUTCDATE(), GETUTCDATE())
        `);

      console.log(`  Created BankTx: ${btx.name}, ${btx.currency} ${btx.amount}`);
    }
  }

  // ============================================================
  // Create KYC Steps
  // ============================================================
  console.log('\nCreating KYC Steps...');

  const kycStepConfigs = [
    // User Hans Muster (kyc10) - basic steps
    { userDataIdx: 1, name: 'ContactData', status: 'Completed', sequenceNumber: 1 },
    { userDataIdx: 1, name: 'PersonalData', status: 'Completed', sequenceNumber: 2 },
    { userDataIdx: 1, name: 'NationalityData', status: 'InProgress', sequenceNumber: 3 },
    // User Anna Schmidt (kyc20) - further along
    { userDataIdx: 2, name: 'ContactData', status: 'Completed', sequenceNumber: 1 },
    { userDataIdx: 2, name: 'PersonalData', status: 'Completed', sequenceNumber: 2 },
    { userDataIdx: 2, name: 'NationalityData', status: 'Completed', sequenceNumber: 3 },
    { userDataIdx: 2, name: 'Ident', type: 'SumsubAuto', status: 'InProgress', sequenceNumber: 4 },
    // User Max Mueller (kyc30) - completed KYC
    { userDataIdx: 3, name: 'ContactData', status: 'Completed', sequenceNumber: 1 },
    { userDataIdx: 3, name: 'PersonalData', status: 'Completed', sequenceNumber: 2 },
    { userDataIdx: 3, name: 'NationalityData', status: 'Completed', sequenceNumber: 3 },
    { userDataIdx: 3, name: 'Ident', type: 'Video', status: 'Completed', sequenceNumber: 4 },
    { userDataIdx: 3, name: 'FinancialData', status: 'Completed', sequenceNumber: 5 },
    { userDataIdx: 3, name: 'DfxApproval', status: 'Completed', sequenceNumber: 6 },
    // User Lisa Weber (kyc50) - full KYC with recommendation
    { userDataIdx: 4, name: 'ContactData', status: 'Completed', sequenceNumber: 1 },
    { userDataIdx: 4, name: 'PersonalData', status: 'Completed', sequenceNumber: 2 },
    { userDataIdx: 4, name: 'NationalityData', status: 'Completed', sequenceNumber: 3 },
    { userDataIdx: 4, name: 'Recommendation', status: 'Completed', sequenceNumber: 4 },
    { userDataIdx: 4, name: 'Ident', type: 'SumsubVideo', status: 'Completed', sequenceNumber: 5 },
    { userDataIdx: 4, name: 'FinancialData', status: 'Completed', sequenceNumber: 6 },
    { userDataIdx: 4, name: 'DfxApproval', status: 'Completed', sequenceNumber: 7 },
  ];

  const kycStepIds = [];
  for (const step of kycStepConfigs) {
    const result = await pool
      .request()
      .input('name', mssql.NVarChar, step.name)
      .input('type', mssql.NVarChar, step.type || null)
      .input('status', mssql.NVarChar, step.status)
      .input('sequenceNumber', mssql.Int, step.sequenceNumber)
      .input('userDataId', mssql.Int, userDataIds[step.userDataIdx]).query(`
        INSERT INTO kyc_step (name, type, status, sequenceNumber, userDataId, created, updated)
        OUTPUT INSERTED.id
        VALUES (@name, @type, @status, @sequenceNumber, @userDataId, GETUTCDATE(), GETUTCDATE())
      `);

    kycStepIds.push(result.recordset[0].id);
    console.log(`  Created KycStep: ${step.name} (${step.status}) for userDataId=${userDataIds[step.userDataIdx]}`);
  }

  // ============================================================
  // Create KYC Logs
  // ============================================================
  console.log('\nCreating KYC Logs...');

  const now = new Date();
  const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  const kycLogConfigs = [
    // Hans Muster - basic logs
    { userDataIdx: 1, type: 'KycLog', comment: 'KYC process started', eventDate: daysAgo(30) },
    { userDataIdx: 1, type: 'StepLog', comment: 'Contact data submitted', eventDate: daysAgo(29), kycStepIdx: 0 },
    { userDataIdx: 1, type: 'StepLog', comment: 'Personal data submitted', eventDate: daysAgo(28), kycStepIdx: 1 },
    { userDataIdx: 1, type: 'NameCheckLog', comment: 'Name check passed - no matches found', eventDate: daysAgo(28) },
    // Anna Schmidt - more activity
    { userDataIdx: 2, type: 'KycLog', comment: 'KYC process started', eventDate: daysAgo(20) },
    { userDataIdx: 2, type: 'StepLog', comment: 'Contact data submitted', eventDate: daysAgo(19), kycStepIdx: 3 },
    { userDataIdx: 2, type: 'StepLog', comment: 'Personal data submitted', eventDate: daysAgo(18), kycStepIdx: 4 },
    { userDataIdx: 2, type: 'NameCheckLog', comment: 'Name check passed', eventDate: daysAgo(18) },
    { userDataIdx: 2, type: 'StepLog', comment: 'Nationality data submitted', eventDate: daysAgo(17), kycStepIdx: 5 },
    {
      userDataIdx: 2,
      type: 'StepLog',
      comment: 'SumSub identification started',
      eventDate: daysAgo(16),
      kycStepIdx: 6,
    },
    { userDataIdx: 2, type: 'ManualLog', comment: 'Agent review: waiting for better ID photo', eventDate: daysAgo(15) },
    // Max Mueller - completed KYC
    { userDataIdx: 3, type: 'KycLog', comment: 'KYC process started', eventDate: daysAgo(60) },
    { userDataIdx: 3, type: 'StepLog', comment: 'Contact data submitted', eventDate: daysAgo(59), kycStepIdx: 7 },
    { userDataIdx: 3, type: 'StepLog', comment: 'Personal data submitted', eventDate: daysAgo(58), kycStepIdx: 8 },
    { userDataIdx: 3, type: 'NameCheckLog', comment: 'Name check passed', eventDate: daysAgo(58) },
    {
      userDataIdx: 3,
      type: 'StepLog',
      comment: 'Video ident completed successfully',
      eventDate: daysAgo(55),
      kycStepIdx: 10,
    },
    { userDataIdx: 3, type: 'StepLog', comment: 'Financial data submitted', eventDate: daysAgo(54), kycStepIdx: 11 },
    { userDataIdx: 3, type: 'StepLog', comment: 'DFX approval granted', eventDate: daysAgo(50), kycStepIdx: 12 },
    { userDataIdx: 3, type: 'KycLog', comment: 'KYC level upgraded to 30', eventDate: daysAgo(50) },
    { userDataIdx: 3, type: 'RiskStatusLog', comment: 'Risk assessment: LOW', eventDate: daysAgo(50) },
    // Lisa Weber - full history
    { userDataIdx: 4, type: 'KycLog', comment: 'KYC process started', eventDate: daysAgo(90) },
    { userDataIdx: 4, type: 'StepLog', comment: 'Contact data submitted', eventDate: daysAgo(89), kycStepIdx: 13 },
    { userDataIdx: 4, type: 'StepLog', comment: 'Personal data submitted', eventDate: daysAgo(88), kycStepIdx: 14 },
    { userDataIdx: 4, type: 'NameCheckLog', comment: 'Name check passed', eventDate: daysAgo(88) },
    { userDataIdx: 4, type: 'StepLog', comment: 'Recommendation confirmed', eventDate: daysAgo(85), kycStepIdx: 16 },
    {
      userDataIdx: 4,
      type: 'StepLog',
      comment: 'SumSub video ident completed',
      eventDate: daysAgo(80),
      kycStepIdx: 17,
    },
    { userDataIdx: 4, type: 'StepLog', comment: 'Financial data submitted', eventDate: daysAgo(78), kycStepIdx: 18 },
    { userDataIdx: 4, type: 'StepLog', comment: 'DFX approval granted', eventDate: daysAgo(75), kycStepIdx: 19 },
    { userDataIdx: 4, type: 'KycLog', comment: 'KYC level upgraded to 50', eventDate: daysAgo(75) },
    { userDataIdx: 4, type: 'RiskStatusLog', comment: 'Risk assessment: LOW', eventDate: daysAgo(75) },
    { userDataIdx: 4, type: 'ManualLog', comment: 'Manual review: all documents verified', eventDate: daysAgo(74) },
    {
      userDataIdx: 4,
      type: 'MailChangeLog',
      comment: 'Email changed from old@test.local to kyc50@test.local',
      eventDate: daysAgo(40),
    },
  ];

  for (const log of kycLogConfigs) {
    await pool
      .request()
      .input('type', mssql.NVarChar, log.type)
      .input('comment', mssql.NVarChar, log.comment)
      .input('eventDate', mssql.DateTime2, log.eventDate)
      .input('userDataId', mssql.Int, userDataIds[log.userDataIdx])
      .input('kycStepId', mssql.Int, log.kycStepIdx != null ? kycStepIds[log.kycStepIdx] : null).query(`
        INSERT INTO kyc_log (type, comment, eventDate, userDataId, kycStepId, created, updated)
        VALUES (@type, @comment, @eventDate, @userDataId, @kycStepId, GETUTCDATE(), GETUTCDATE())
      `);

    console.log(
      `  Created KycLog: ${log.type} - "${log.comment.substring(0, 40)}..." for userDataId=${userDataIds[log.userDataIdx]}`,
    );
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n========================================');
  console.log('Test data creation complete!');
  console.log('========================================\n');

  // Show counts
  const tables = [
    'user_data',
    '[user]',
    'buy',
    'bank_data',
    'deposit',
    '[transaction]',
    'bank_tx',
    'kyc_step',
    'kyc_log',
  ];
  for (const t of tables) {
    const count = await pool.request().query(`SELECT COUNT(*) as c FROM ${t}`);
    console.log(`  ${t.replace('[', '').replace(']', '')}: ${count.recordset[0].c} rows`);
  }

  await pool.close();
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
