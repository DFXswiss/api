import { Currency } from '@uniswap/sdk-core';
import { Agent } from 'https';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpRequestConfig, HttpService } from 'src/shared/services/http.service';
import { fromBaseUnits } from 'src/shared/models/base-units.transformer';
import { Util } from 'src/shared/utils/util';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../shared/dto/signed-transaction-reponse.dto';
import {
  PreBroadcastRpcMessage,
  TxBroadcastError,
  toBroadcastBoundaryError,
} from '../shared/errors/tx-broadcast.error';
import { BlockchainClient, CoinOnly } from '../shared/util/blockchain-client';
import {
  AddressResultDto,
  GetAddressResultDto,
  GetBalanceResultDto,
  GetFeeEstimateResultDto,
  GetInfoResultDto,
  GetRelayTransactionResultDto,
  GetSendTransferResultDto,
  GetTransactionResultDto,
  GetTransfersResultDto,
  MoneroSignedTxDto,
  MoneroTransactionDto,
  MoneroTransactionType,
  MoneroTransferDto,
  VerifyResultDto,
} from './dto/monero.dto';
import { MoneroHelper } from './monero-helper';

// Codes cited from Monero src/wallet/wallet_rpc_server_error_codes.h; the mapping happens in
// wallet_rpc_server::handle_rpc_exception (src/wallet/wallet_rpc_server.cpp). Both entries below are
// pre-funding checks that run before the transaction is constructed at all, so a plain error safely
// rolls back for auto-retry.
const MONERO_PRE_BROADCAST_RPC_CODES = [
  -17, // WALLET_RPC_ERROR_CODE_NOT_ENOUGH_MONEY
  -37, // WALLET_RPC_ERROR_CODE_NOT_ENOUGH_UNLOCKED_MONEY
];

// DELIBERATELY NOT ALLOWLISTED: -38 WALLET_RPC_ERROR_CODE_NO_DAEMON_CONNECTION.
//
// It is tempting (the message reads "no connection to daemon", which sounds pre-broadcast) and it is
// the most frequent flavour we see in production, but it is not safe by code:
//
//   - handle_rpc_exception's catch for tools::error::no_connection_to_daemon is UNCONDITIONAL, so every
//     throw site collapses onto -38 regardless of phase.
//   - The relay itself throws it. wallet2::commit_tx invokes /sendrawtransaction and immediately runs
//     THROW_ON_RPC_RESPONSE_ERROR (wallet2.cpp ~7103-7104); that macro's helper throw_on_rpc_response_error
//     (wallet2.cpp ~15134-15139) raises no_connection_to_daemon whenever the HTTP call returns false or
//     the status is empty — i.e. exactly when the daemon accepted the tx but the response was lost.
//     (The submit_raw_tx site is light-wallet-only and does not apply to us; the generic helper does.)
//   - what() is a fixed string for all of those sites, and the discriminating request name
//     ("sendrawtransaction" vs "get_output_distribution") lives only in to_string()/m_request, which the
//     RPC server never calls. So there is no message-based rescue for -38 either.
//
// Retrying is actively harmful here, not merely uncertain: commit_tx writes its local bookkeeping only
// AFTER the relay call returns (add_unconfirmed_tx ~7128, set_spent ~7139). A lost response therefore
// leaves no pending entry and no reserved key images, so a retry re-selects the same inputs and builds a
// second transaction over the same key images — a real double-spend race whose winner may be a txid the
// order never learned. That is the invariant #4238 exists to protect.
//
// The structural remedy sketched here has since been built (#4673): buildTransfer + relayTransfer below
// split the atomic call, so the payout path never has to classify a -38 from `transfer` at all. What
// remains behind these allowlists is sendTransfers, the atomic path kept for callers that have no order
// to persist a pre-relay txid against (dex withdrawal, pay-in forwarding) — for those, an unclassified
// -38 must keep failing closed for exactly the reason above.
//
// Daemon faults that fall through to GENERIC_TRANSFER_ERROR (-4) — handle_rpc_exception has no dedicated
// catch for them — are discriminated by their exact what() string instead, since -4 is also the code for
// genuinely post-broadcast failures (e.g. tools::error::tx_rejected, "transaction was rejected by daemon").
//
// - "failed to get output distribution": tools::error::get_output_distribution. Note this is NOT the
//   transport-failure case (a dead connection while fetching the distribution throws -38 via the helper
//   above); -4 is reached only when the daemon ANSWERED with a non-OK status, or answered with a
//   distribution that failed validation. That makes it a deterministic node answer — #4238's Class B
//   rationale — and every throw site sits in wallet2::get_outs during decoy selection, called from
//   transfer_selected{,_rct} before inputs are prepared and before anything is signed. The what() string
//   is hard-coded in the class constructor (src/wallet/wallet_errors.h) and is unique in the tree.
const MONERO_PRE_BROADCAST_RPC_MESSAGES: PreBroadcastRpcMessage[] = [
  { code: -4, message: 'failed to get output distribution' },
];

const MONERO_REQUEST_TIMEOUT_MS = 30_000;

// Pinned explicitly rather than left to the wallet's silent correction: an unset ring_size arrives as 0,
// wallet_rpc_server turns that into mixin 0 and adjust_mixin then raises it to the consensus minimum,
// logging "Requested ring size 1 too low, using 16" on every production transfer (#4673). 16 is
// CRYPTONOTE_DEFAULT_TX_MIXIN + 1 and therefore the value the wallet was already choosing.
const MONERO_RING_SIZE = 16;

export class MoneroClient extends BlockchainClient implements CoinOnly {
  private agent?: Agent;

  constructor(private readonly http: HttpService) {
    super();
  }

  // --- MONERO DAEMON --- //

  get walletAddress(): string {
    return Config.blockchain.monero.walletAddress;
  }

  async getInfo(): Promise<GetInfoResultDto> {
    return this.http
      .post<{ result: GetInfoResultDto }>(
        `${Config.blockchain.monero.node.url}/json_rpc`,
        {
          method: 'get_info',
          params: { account_index: 0 },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  async getBlockHeight(): Promise<number> {
    return this.http
      .post<{ height: number }>(`${Config.blockchain.monero.node.url}/get_height`, {}, this.httpConfig())
      .then((r) => r.height);
  }

  async getFeeEstimate(): Promise<GetFeeEstimateResultDto> {
    return this.http
      .post<{ result: GetFeeEstimateResultDto }>(
        `${Config.blockchain.monero.node.url}/json_rpc`,
        {
          method: 'get_fee_estimate',
          params: {},
        },
        this.httpConfig(),
      )
      .then((r) => this.convertFeeEstimateAuToXmr(r.result));
  }

  // --- UNIMPLEMENTED METHODS --- //

  async getToken(_: Asset): Promise<Currency> {
    throw new Error('Monero has no token');
  }

  async getTokenBalance(_: Asset, __?: string): Promise<number> {
    throw new Error('Monero has no token');
  }

  async getTokenBalances(_: Asset[], __?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Monero has no token');
  }

  async sendSignedTransaction(_: string): Promise<SignedTransactionResponse> {
    throw new Error('Method not implemented');
  }

  // --- PRIVATE HELPER METHODS --- //

  async isTxComplete(txId: string, confirmations?: number): Promise<boolean> {
    const transaction = await this.getTransaction(txId);
    return MoneroHelper.isTransactionComplete(transaction, confirmations);
  }

  private convertFeeEstimateAuToXmr(feeEstimateResult: GetFeeEstimateResultDto): GetFeeEstimateResultDto {
    feeEstimateResult.fee = MoneroHelper.auToXmr(feeEstimateResult.fee) ?? 0;
    feeEstimateResult.fees = feeEstimateResult.fees.map((fee) => MoneroHelper.auToXmr(fee) ?? 0);

    return feeEstimateResult;
  }

  async getTransaction(txId: string): Promise<MoneroTransactionDto | undefined> {
    return this.http
      .post<{ status: string; txs: GetTransactionResultDto[] }>(
        `${Config.blockchain.monero.node.url}/get_transactions`,
        {
          txs_hashes: [txId],
          decode_as_json: true,
        },
        this.httpConfig(),
      )
      .then((r) => this.mapTransaction(r.status, r.txs));
  }

  private mapTransaction(status: string, txs?: GetTransactionResultDto[]): MoneroTransactionDto {
    // An unknown hash comes back as status OK with the hash listed under missed_tx and `txs` either
    // absent or empty; both mean "not found", and reading txs[0] out of an empty array would throw.
    if ('OK' !== status || !txs?.length) return {};

    const transactionResult = txs[0];

    const txnAsJson = transactionResult.as_json;
    const transaction = <MoneroTransactionDto>JSON.parse(txnAsJson);

    transaction.block_height = transactionResult.block_height;
    transaction.block_timestamp = transactionResult.block_timestamp;
    transaction.confirmations = transactionResult.confirmations;
    transaction.tx_hash = transactionResult.tx_hash;

    transaction.txnFee = MoneroHelper.auToXmr(this.mapTransactionFee(transaction)) ?? 0;

    return transaction;
  }

  private mapTransactionFee(transaction: MoneroTransactionDto): number {
    const vinAmounts = transaction.vin?.map((vin) => vin.key.amount) ?? [0];
    const voutAmounts = transaction.vout?.map((vout) => vout.amount) ?? [0];

    const totalVinAmount = Util.sum(vinAmounts);
    const totalVoutAmount = Util.sum(voutAmounts);

    transaction.inAmount = MoneroHelper.auToXmr(totalVinAmount) ?? 0;
    transaction.outAmount = MoneroHelper.auToXmr(totalVoutAmount) ?? 0;

    const transactionFee = totalVinAmount - totalVoutAmount;
    if (transactionFee > 0) return transactionFee;

    return transaction.rct_signatures?.txnFee ?? 0;
  }

  // --- MONERO WALLET --- //

  async verifySignature(message: string, address: string, signature: string): Promise<VerifyResultDto> {
    return this.http
      .post<{ result: VerifyResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'verify',
          params: { data: message, address: address, signature: signature },
        },
        this.httpConfig(),
      )
      .then((r) => r.result);
  }

  async createAddress(label?: string): Promise<AddressResultDto> {
    const result = await this.http
      .post<{ result: AddressResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'create_address',
          params: {
            account_index: 0,
            label: label,
            count: 1,
          },
        },
        this.httpConfig(),
      )
      .then((r) => this.mapAddress(r.result, label));

    await this.store();

    return result;
  }

  private mapAddress(addressResult: AddressResultDto, label?: string): AddressResultDto {
    addressResult.label = label;
    addressResult.used = false;
    return addressResult;
  }

  async getAddresses(): Promise<AddressResultDto[]> {
    return this.http
      .post<{ result: GetAddressResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'get_address',
          params: {
            account_index: 0,
          },
        },
        this.httpConfig(),
      )
      .then((r) => r.result.addresses);
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance().then((b) => b.balance);
  }

  async getUnlockedBalance(): Promise<number> {
    return this.getBalance().then((b) => b.unlocked_balance);
  }

  private async getBalance(): Promise<GetBalanceResultDto> {
    return this.http
      .post<{ result: GetBalanceResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'get_balance',
          params: { account_index: 0 },
        },
        this.httpConfig(),
      )
      .then((r) => this.convertBalanceAuToXmr(r.result));
  }

  async getNativeCoinBalanceForAddress(_: string): Promise<number> {
    throw new Error('Coin balance for address not possible for monero');
  }

  private convertBalanceAuToXmr(balanceResultDto: GetBalanceResultDto): GetBalanceResultDto {
    balanceResultDto.balance = MoneroHelper.auToXmr(balanceResultDto.balance) ?? 0;
    balanceResultDto.unlocked_balance = MoneroHelper.auToXmr(balanceResultDto.unlocked_balance) ?? 0;

    return balanceResultDto;
  }

  async sendTransfer(destinationAddress: string, amount: number): Promise<MoneroTransferDto> {
    return this.sendTransfers([{ addressTo: destinationAddress, amount }]);
  }

  // Broadcast boundary: the wallet RPC's 'transfer' method builds, signs and relays atomically.
  // Connection-establishment failures and the official wallet pre-funding codes stay plain;
  // parsed RPC errors are deterministic, while ambiguous transport failures fail closed.
  //
  // Callers that own a payout order should use buildTransfer + relayTransfer instead (#4673); this
  // atomic path remains for callers with nowhere to persist a pre-relay txid.
  async sendTransfers(payout: PayoutGroup): Promise<MoneroTransferDto> {
    try {
      const result = await this.http.post<GetSendTransferResultDto>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'transfer',
          params: this.transferParams(payout),
        },
        this.httpConfig(),
      );

      // Response mapping stays inside the boundary: a malformed/empty body throwing while reading
      // result.error would otherwise be a plain error and self-heal a possibly-relayed transfer.
      return this.mapSendTransfer(result);
    } catch (e) {
      throw toBroadcastBoundaryError(e, MONERO_PRE_BROADCAST_RPC_CODES, MONERO_PRE_BROADCAST_RPC_MESSAGES);
    }
  }

  // Build and sign, without relaying — phase one of the split introduced by #4673.
  //
  // do_not_relay is what makes this phase safe to retry blindly: wallet_rpc_server::fill_response guards
  // the relay with `else if (!do_not_relay) m_wallet->commit_tx(ptx_vector);`, and commit_tx is the sole
  // caller of /sendrawtransaction, add_unconfirmed_tx and set_spent. Skipping it means the wallet reserves
  // nothing at all, so a failure here — a lost response, a timeout, a -38 from decoy selection — is
  // provably pre-broadcast no matter which sub-request threw. That is why this method deliberately does
  // NOT wrap its errors in the broadcast boundary: they stay plain and roll back for auto-retry like the
  // -17/-37 pre-funding codes. Verified against monero v0.18.3.4, the tag the production wallet image
  // runs; the guarantee is a property of that guard, so a wallet version that relayed despite
  // do_not_relay would invalidate it.
  //
  // The returned tx_hash is final: relay_tx re-submits this very transaction rather than rebuilding one.
  async buildTransfer(payout: PayoutGroup): Promise<MoneroSignedTxDto> {
    const result = await this.http.post<GetSendTransferResultDto>(
      `${Config.blockchain.monero.rpc.url}/json_rpc`,
      {
        method: 'transfer',
        params: { ...this.transferParams(payout), do_not_relay: true, get_tx_metadata: true },
      },
      this.httpConfig(),
    );

    return this.mapSignedTransfer(result);
  }

  // Relay a transaction built by buildTransfer — phase two, and the only step that can leave a
  // transaction in flight. wallet_rpc_server::on_relay_tx deserialises the metadata into a pending_tx and
  // calls m_wallet->commit_tx(ptx) on it, so a repeat re-submits the SAME transaction under the SAME id
  // instead of building a competing one over the same inputs; the daemon short-circuits a transaction it
  // already has (core::handle_incoming_txs marks it already_have and leaves the verification context
  // untouched, so on_send_raw_tx answers OK with not_relayed) and commit_tx does not throw.
  //
  // The boundary stays fail-closed here with no RPC-code allowlist at all: the pre-funding codes cannot
  // occur once the transaction is signed, and -38 at this point is the genuinely ambiguous case. Class A
  // connection-establishment failures still classify as plain by construction — the request never left.
  async relayTransfer(metadata: string): Promise<string> {
    try {
      const result = await this.http.post<GetRelayTransactionResultDto>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'relay_tx',
          params: { hex: metadata },
        },
        this.httpConfig(),
      );

      return this.mapRelayTransfer(result);
    } catch (e) {
      // Empty allowlists on purpose: only Class A (connection establishment) stays plain here.
      throw toBroadcastBoundaryError(e, []);
    }
  }

  // Presence, not confirmation: the daemon's /get_transactions answers for the mempool as well as the
  // chain, so a hit proves the transaction reached the network even before it is mined. This is the
  // lookup that replaces the inference for a relay whose response was lost (#4673).
  async isTxKnown(txId: string): Promise<boolean> {
    const transaction = await this.getTransaction(txId);

    return Boolean(transaction?.tx_hash);
  }

  private transferParams(payout: PayoutGroup): Record<string, unknown> {
    return {
      destinations: payout.map((p) => ({ address: p.addressTo, amount: MoneroHelper.xmrToAu(p.amount) })),
      account_index: 0,
      priority: 0,
      ring_size: MONERO_RING_SIZE,
    };
  }

  private mapSendTransfer(sendTransferResult: GetSendTransferResultDto): MoneroTransferDto {
    if (sendTransferResult.error)
      throw toBroadcastBoundaryError(
        sendTransferResult.error,
        MONERO_PRE_BROADCAST_RPC_CODES,
        MONERO_PRE_BROADCAST_RPC_MESSAGES,
      );
    if (!sendTransferResult.result) throw new TxBroadcastError('No result after send transfer');
    // Empty tx_hash after a resolved transfer is ambiguous (wallet may already have relayed).
    if (!sendTransferResult.result.tx_hash) {
      throw new TxBroadcastError('Monero broadcast returned an empty tx hash', { cause: sendTransferResult });
    }

    return this.convertTransferAuToXmr({
      amount: sendTransferResult.result.amount,
      fee: sendTransferResult.result.fee,
      txid: sendTransferResult.result.tx_hash,
    });
  }

  // Every failure of the build phase is plain (see buildTransfer), so these throws are plain too — an
  // unusable response means the wallet has nothing to relay, not that it might have relayed something.
  private mapSignedTransfer(buildResult: GetSendTransferResultDto): MoneroSignedTxDto {
    if (!buildResult) throw new Error('No response after building the Monero transfer');
    if (buildResult.error) throw new Error(buildResult.error.message, { cause: buildResult.error });
    if (!buildResult.result) throw new Error('No result after building the Monero transfer');

    const { tx_hash, tx_metadata } = buildResult.result;
    if (!tx_hash) throw new Error('Monero transfer build returned an empty tx hash');
    // Without the metadata the transaction can never be relayed and would have to be rebuilt, which is
    // the one thing the split exists to avoid — refuse it here rather than persist a dead id.
    if (!tx_metadata) throw new Error('Monero transfer build returned no tx metadata');

    return { txId: tx_hash, metadata: tx_metadata };
  }

  private mapRelayTransfer(relayResult: GetRelayTransactionResultDto): string {
    // Unconditional, with no allowlist to consult: an in-band wallet RPC error at this point was raised
    // by commit_tx, which had already called /sendrawtransaction. There is no code here that proves the
    // transaction stayed put, so every one of them is at-or-after the broadcast.
    if (relayResult.error) throw new TxBroadcastError(relayResult.error.message, { cause: relayResult.error });
    if (!relayResult.result) throw new TxBroadcastError('No result after relaying the Monero transfer');
    // An empty tx_hash after a resolved relay is ambiguous the same way an empty one after `transfer` is.
    if (!relayResult.result.tx_hash)
      throw new TxBroadcastError('Monero relay returned an empty tx hash', { cause: relayResult });

    return relayResult.result.tx_hash;
  }

  async getTransfers(type: MoneroTransactionType, blockHeight: number): Promise<MoneroTransferDto[]> {
    const transfers = await this.http
      .post<{ result: GetTransfersResultDto }>(
        `${Config.blockchain.monero.rpc.url}/json_rpc`,
        {
          method: 'get_transfers',
          params: {
            [type]: true,
            filter_by_height: true,
            min_height: blockHeight,
          },
        },
        this.httpConfig(),
      )
      .then((r) => r.result[type]?.map((t) => this.convertTransferAuToXmr(t)) ?? []);

    return this.sortTransfers(transfers);
  }

  private sortTransfers(transfers: MoneroTransferDto[]): MoneroTransferDto[] {
    return Util.sort(transfers, 'timestamp', 'DESC');
  }

  private convertTransferAuToXmr(transfer: MoneroTransferDto): MoneroTransferDto {
    // §2.3 native-first exactness (#4287 stage 3): capture the EXACT whole-unit XMR decimal string from the raw
    // atomic-unit (piconero, 12-dp) integer BEFORE the lossy auToXmr float collapse below — Monero is 12-dp, beyond the
    // ledger's 8-dp float derivation, so this lets the deposit book the 9th–12th decimals exactly. Only a safe-integer
    // atomic value is captured: a piconero count above 2^53 is already corrupted by JSON.parse in the RPC response, so
    // above that we leave it undefined and the ledger derives from the float (fail-open).
    transfer.amountExact =
      Number.isSafeInteger(transfer.amount) && transfer.amount >= 0
        ? fromBaseUnits(BigInt(transfer.amount), MoneroHelper.AU_XMR_DECIMALS)
        : undefined;
    transfer.amount = MoneroHelper.auToXmr(transfer.amount) ?? 0;
    transfer.fee = MoneroHelper.auToXmr(transfer.fee) ?? 0;

    transfer.destinations?.forEach((d) => (d.amount = MoneroHelper.auToXmr(d.amount) ?? 0));

    return transfer;
  }

  async store(): Promise<void> {
    await this.http.post(
      `${Config.blockchain.monero.rpc.url}/json_rpc`,
      {
        method: 'store',
      },
      this.httpConfig(),
    );
  }

  // --- HELPER --- //

  private httpConfig(): HttpRequestConfig {
    // one keep-alive agent per client: without it every call pays a full TCP + TLS handshake
    this.agent ??= new Agent({
      ca: Config.blockchain.monero.certificate,
      keepAlive: true,
    });

    return {
      httpsAgent: this.agent,
      timeout: MONERO_REQUEST_TIMEOUT_MS,
    };
  }
}
