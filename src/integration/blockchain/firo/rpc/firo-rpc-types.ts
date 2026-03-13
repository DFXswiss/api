/**
 * Firo-specific RPC type extensions.
 *
 * Firo's getrawtransaction (verbose=true) returns address and value directly
 * on the vin level, instead of nesting them in a prevout object like Bitcoin Core (verbosity=2).
 */

import { RawTransaction, RawTransactionVin } from '../../bitcoin/node/rpc';

export interface FiroRawTransactionVin extends RawTransactionVin {
  address?: string;
  value?: number;
  valueSat?: number;
}

export interface FiroRawTransaction extends Omit<RawTransaction, 'vin'> {
  vin: FiroRawTransactionVin[];
}
