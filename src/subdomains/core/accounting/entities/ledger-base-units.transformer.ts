// §2.3 native-first exactness. The base-units transformer + conversions moved to `src/shared/models/base-units.transformer`
// so on-chain source entities (crypto_input, payout_order) can persist the same EXACT integer base-unit column without
// importing the accounting subdomain (avoiding an import cycle). Re-exported here so the accounting entities/services
// keep their existing import path unchanged.
export { baseUnitsTransformer, fromDecimalString, toBaseUnits } from 'src/shared/models/base-units.transformer';
