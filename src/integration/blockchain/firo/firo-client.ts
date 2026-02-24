import { Config, GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BitcoinBasedClient, TestMempoolResult } from '../bitcoin/node/bitcoin-based-client';
import { Block, NodeClientConfig } from '../bitcoin/node/node-client';
import { FiroRawTransaction } from './rpc';

/**
 * Firo RPC client - overrides Bitcoin Core methods that are incompatible with Firo.
 *
 * Firo (v0.14.15.2) is based on an older Bitcoin Core fork and differs in several RPC methods:
 * - send: does not exist (Bitcoin Core 0.21+), use settxfee + sendmany instead
 * - getnewaddress: only accepts (account), no address_type parameter
 * - getbalances: does not exist, use getbalance instead
 * - estimatesmartfee: only accepts (nblocks), no estimate_mode parameter
 * - testmempoolaccept: does not exist
 * - listwallets: does not exist (no multi-wallet support)
 * - sendmany: max 5 params (no replaceable/conf_target/estimate_mode)
 * - getblock: verbose is boolean, not int verbosity (0/1/2)
 * - getrawtransaction: boolean verbose, no multi-level verbosity, no prevout in result
 */
export class FiroClient extends BitcoinBasedClient {
  constructor(http: HttpService, url: string) {
    const firoConfig = GetConfig().blockchain.firo;

    const config: NodeClientConfig = {
      user: firoConfig.user,
      password: firoConfig.password,
      walletPassword: firoConfig.walletPassword,
      allowUnconfirmedUtxos: firoConfig.allowUnconfirmedUtxos,
    };

    super(http, url, config);
  }

  get walletAddress(): string {
    return Config.blockchain.firo.walletAddress;
  }

  get paymentAddress(): string {
    return Config.payment.firoAddress;
  }

  // --- RPC Overrides for Firo compatibility --- //

  // Firo's getnewaddress only accepts an optional account parameter, no address type
  async createAddress(label: string, _type?: string): Promise<string> {
    return this.callNode(() => this.rpc.call<string>('getnewaddress', [label]), true);
  }

  // Firo's account-based getbalance with '' returns only the default account, which can be negative.
  // Use listunspent filtered to the liquidity and payment addresses for an accurate spendable balance.
  async getBalance(): Promise<number> {
    const utxos = await this.getUtxoForAddresses(
      [this.walletAddress, this.paymentAddress],
      this.nodeConfig.allowUnconfirmedUtxos,
    );

    return utxos?.reduce((sum, u) => sum + u.amount, 0) ?? 0;
  }

  // Firo's getblock uses boolean verbose, not int verbosity (0/1/2)
  async getBlock(hash: string): Promise<Block> {
    return this.callNode(() => this.rpc.call<Block>('getblock', [hash, true]));
  }

  // Firo's getrawtransaction uses boolean verbose (true/false), not numeric verbosity (0/1/2).
  // Returns FiroRawTransaction with vin[].address directly (no prevout nesting like Bitcoin Core).
  async getRawTx(txId: string): Promise<FiroRawTransaction | null> {
    try {
      return await this.callNode(() => this.rpc.call<FiroRawTransaction>('getrawtransaction', [txId, true]));
    } catch {
      return null;
    }
  }

  // Firo's estimatesmartfee only accepts nblocks, no estimate_mode parameter
  async estimateSmartFee(confTarget = 1): Promise<number | null> {
    const result = await this.callNode(() =>
      this.rpc.call<{ feerate?: number; blocks: number }>('estimatesmartfee', [confTarget]),
    );

    if (result?.feerate && result.feerate > 0) {
      return result.feerate * 100000; // BTC/kvB → sat/vB
    }
    return null;
  }

  // Firo does not have the 'send' RPC (Bitcoin Core 0.21+).
  // Uses explicit input to ensure only the specified UTXO is spent (forwarding from deposit addresses).
  async send(
    addressTo: string,
    txId: string,
    amount: number,
    vout: number,
    feeRate: number,
  ): Promise<{ outTxId: string; feeAmount: number }> {
    const feeAmount = (feeRate * 225) / 1e8;
    const sendAmount = this.roundAmount(amount - feeAmount);

    const outTxId = await this.buildSignAndBroadcast([{ txid: txId, vout }], { [addressTo]: sendAmount });

    return { outTxId, feeAmount };
  }

  // Use UTXOs from the liquidity and payment addresses to avoid spending deposit UTXOs.
  // Change is sent back to the liquidity address, naturally consolidating funds over time.
  async sendMany(payload: { addressTo: string; amount: number }[], feeRate: number): Promise<string> {
    const outputs = payload.reduce(
      (acc, p) => ({ ...acc, [p.addressTo]: this.roundAmount(p.amount) }),
      {} as Record<string, number>,
    );
    const outputTotal = payload.reduce((sum, p) => sum + p.amount, 0);

    // Get UTXOs from liquidity and payment addresses (excludes deposit address UTXOs)
    const utxos = await this.getUtxoForAddresses(
      [this.walletAddress, this.paymentAddress],
      this.nodeConfig.allowUnconfirmedUtxos,
    );

    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs available on the liquidity/payment addresses');
    }

    // Select UTXOs to cover outputs + estimated fee (225 bytes per input, 34 per output, 10 overhead)
    const sortedUtxos = utxos.sort((a, b) => b.amount - a.amount);
    const selectedInputs: { txid: string; vout: number }[] = [];
    let inputTotal = 0;

    for (const utxo of sortedUtxos) {
      selectedInputs.push({ txid: utxo.txid, vout: utxo.vout });
      inputTotal += utxo.amount;

      const estimatedSize = selectedInputs.length * 225 + (payload.length + 1) * 34 + 10;
      const estimatedFee = (feeRate * estimatedSize) / 1e8;

      if (inputTotal >= outputTotal + estimatedFee) break;
    }

    // Calculate final fee and change
    const txSize = selectedInputs.length * 225 + (payload.length + 1) * 34 + 10;
    const fee = (feeRate * txSize) / 1e8;

    if (inputTotal < outputTotal + fee) {
      throw new Error(
        `Insufficient funds on liquidity/payment addresses: have ${inputTotal}, need ${outputTotal + fee}`,
      );
    }

    const change = this.roundAmount(inputTotal - outputTotal - fee);
    if (change > 0.00001) {
      outputs[this.walletAddress] = (outputs[this.walletAddress] ?? 0) + change;
      outputs[this.walletAddress] = this.roundAmount(outputs[this.walletAddress]);
    }

    return this.buildSignAndBroadcast(selectedInputs, outputs);
  }

  // Creates, signs, and broadcasts a raw transaction with explicit inputs.
  private async buildSignAndBroadcast(
    inputs: { txid: string; vout: number }[],
    outputs: Record<string, number>,
  ): Promise<string> {
    const rawTx = await this.callNode(() => this.rpc.call<string>('createrawtransaction', [inputs, outputs]), true);

    const signedResult = await this.callNode(
      () => this.rpc.call<{ hex: string; complete: boolean }>('signrawtransaction', [rawTx]),
      true,
    );

    if (!signedResult.complete) {
      throw new Error('Failed to sign Firo transaction');
    }

    return this.callNode(() => this.rpc.call<string>('sendrawtransaction', [signedResult.hex]), true);
  }

  // Delegates to sendMany which uses manual coin selection from the liquidity and payment addresses.
  async sendUtxoToMany(payload: { addressTo: string; amount: number }[]): Promise<string> {
    if (payload.length > 100) {
      throw new Error('Too many addresses in one transaction batch, allowed max 100 for UTXO');
    }

    const feeRate = (await this.estimateSmartFee(1)) ?? 10;
    return this.sendMany(payload, feeRate);
  }

  // Firo's getmempoolentry returns { fee, size } instead of { fees: { base }, vsize } (pre-0.17 format)
  async getMempoolEntry(txid: string): Promise<{ feeRate: number; vsize: number } | null> {
    try {
      const result = await this.callNode(() =>
        this.rpc.call<{ fee?: number; size?: number }>('getmempoolentry', [txid]),
      );

      if (result?.fee && result?.size) {
        const feeRate = (result.fee * 100000000) / result.size;
        return { feeRate, vsize: result.size };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Firo does not support testmempoolaccept RPC.
  // Emulate it using decoderawtransaction + input lookup to calculate fee and size.
  // Firo has no SegWit, so size == vsize.
  async testMempoolAccept(hex: string): Promise<TestMempoolResult[]> {
    try {
      const decoded = await this.callNode(() => this.rpc.call<FiroRawTransaction>('decoderawtransaction', [hex]));

      const outputTotal = decoded.vout.reduce((sum, out) => sum + out.value, 0);

      // Firo's decoderawtransaction includes vin.value directly
      let inputTotal = 0;
      for (const vin of decoded.vin) {
        if (vin.value === undefined) {
          const prevTx = await this.getRawTx(vin.txid);
          if (!prevTx) {
            return [
              { txid: decoded.txid, allowed: false, vsize: 0, fees: { base: 0 }, 'reject-reason': 'missing-inputs' },
            ];
          }
          inputTotal += prevTx.vout[vin.vout].value;
        } else {
          inputTotal += vin.value;
        }
      }

      const fee = this.roundAmount(inputTotal - outputTotal);

      return [
        {
          txid: decoded.txid,
          allowed: fee > 0,
          vsize: decoded.size,
          fees: { base: fee },
          'reject-reason': fee <= 0 ? 'insufficient-fee' : '',
        },
      ];
    } catch (e) {
      return [{ txid: '', allowed: false, vsize: 0, fees: { base: 0 }, 'reject-reason': e.message ?? 'decode-failed' }];
    }
  }
}
