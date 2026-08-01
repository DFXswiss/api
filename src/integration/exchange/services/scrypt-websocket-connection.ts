import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import WebSocket from 'ws';

enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
}

interface ScryptMessage {
  reqid?: number;
  type?: ScryptMessageType;
  ts?: string;
  data?: any;
  initial?: boolean;
  seqNum?: number;
  error?: string;
  next?: string;
}

export enum ScryptMessageType {
  NEW_WITHDRAW_REQUEST = 'NewWithdrawRequest',
  NEW_DEPOSIT_REQUEST = 'NewDepositRequest',
  BALANCE_TRANSACTION = 'BalanceTransaction',
  BALANCE = 'Balance',
  TRADE = 'Trade',
  ERROR = 'error',
  // Trading
  NEW_ORDER_SINGLE = 'NewOrderSingle',
  EXECUTION_REPORT = 'ExecutionReport',
  // Market Data
  MARKET_DATA_SNAPSHOT = 'MarketDataSnapshot',
  SECURITY = 'Security',
  // Order Management
  ORDER_CANCEL_REQUEST = 'OrderCancelRequest',
  ORDER_CANCEL_REPLACE_REQUEST = 'OrderCancelReplaceRequest',
}

enum ScryptRequestType {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  PAGE = 'page',
  CANCEL = 'cancel',
}

// Schemes we accept for a network endpoint. ws additionally supports ws+unix:, which we exclude deliberately —
// a Scrypt endpoint is remote. Every other scheme makes the ws constructor throw synchronously, which looks
// identical to an unparseable URL from here and is just as unfixable by retrying.
const DIALABLE_WS_PROTOCOLS = ['ws:', 'wss:', 'http:', 'https:'];

/**
 * A URL the client can actually dial. Shared with ScryptService.isConfigured so that "configured" and
 * "connectable" cannot drift apart: a URL that merely parses would otherwise pass the config guard, register
 * every subscription, and then fail identically on every attempt with nothing able to fix it.
 *
 * Scheme and fragment are the whole test. It rejects `ftp://host` (parses, but the client refuses the scheme),
 * a bare `host:443` (parses, but as scheme `host:` with no authority) and `wss://host/ws#x` (the ws client
 * throws on any fragment). No separate host check: all four schemes are special, and for those the URL parser
 * already rejects an empty host.
 */
export function isDialableWsUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return !parsed.hash && DIALABLE_WS_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export const TRANSIENT_WS_ERROR_MARKERS = ['Connection closed', 'unknown reqid'];

export function isTransientWsError(e: Error): boolean {
  return TRANSIENT_WS_ERROR_MARKERS.some((m) => e.message?.toLowerCase().includes(m.toLowerCase()));
}

/**
 * A request was sent but no answer arrived within its deadline.
 *
 * Deliberately its own type rather than another entry in TRANSIENT_WS_ERROR_MARKERS: those markers describe
 * a socket that demonstrably dropped the request, so retrying is safe for anything. A timeout describes
 * silence — the venue may or may not have acted. Only idempotent reads may retry it; every write path must
 * translate it into an unknown outcome. Matching on the message text instead would make that distinction
 * impossible to enforce, because both kinds of timeout would read the same.
 */
export class ScryptRequestTimeoutError extends Error {}

/**
 * A write that may or may not have taken effect at the venue — raised where an order was created, amended or
 * restarted and no reply confirmed the outcome.
 *
 * Distinct from {@link ScryptRequestTimeoutError}, which describes only *how* the call ended: the same
 * dropped socket is harmless on a read and unresolved on a write, so the distinction that matters to the
 * caller is the side effect, not the transport. Anything carrying this type must be quarantined and
 * reconciled, never repeated.
 */
export class ScryptUnconfirmedWriteError extends Error {
  constructor(
    message: string,
    readonly reference: string | undefined,
  ) {
    super(message);
  }
}

/**
 * An order the venue once acknowledged can no longer be found in its state.
 *
 * Not a failure: the order may have completed or been cancelled outside our view, and we cannot tell which.
 * Treating it as failed would release the rule to open a second position against the same funds.
 */
export class ScryptOrderNotFoundError extends Error {}

/**
 * A trade whose venue reference this process has continuously observed reporting PENDING_NEW/PENDING_CANCEL/
 * PENDING_REPLACE for longer than PENDING_STUCK_AFTER_MINUTES, and whose outstanding reference the venue then
 * answered on an explicit cancel request with `ScryptCancellation.SETTLED` — one of two distinct qualities of
 * answer, per that enum's own documentation: a terminal cancel with nothing filled, or the venue not
 * recognising the reference at all (`SCRYPT_UNKNOWN_ORDER`), which is an inference from its own words rather
 * than a statement about execution.
 *
 * The bound measures how long this process has continuously observed the reference as PENDING, beginning
 * with its first such observation. It does not measure the age of the order itself.
 *
 * Both qualities of SETTLED carry the weight this error rests on, but not for the same reason. A terminal
 * cancel states it outright. `UnknownOrder` rests on the inference documented at SCRYPT_UNKNOWN_ORDER: a
 * venue that does not recognise a reference cannot execute anything under it. Deliberately NOT argued as
 * the venue contradicting its own last answer — the status read here comes from the cached execution report
 * and is not re-fetched before the cancel, so a live push may have moved it on in between, and "its last
 * answer" is then not what this branch saw.
 *
 * Distinct from {@link ScryptOrderNotFoundError}: that one means the venue cannot find the order at all, an
 * unresolved blind spot. Here the venue found it, answered PENDING, and then settled it on request — which is
 * why the caller may fail the order instead of quarantining it. No change in behaviour from this wording,
 * only a more honest account of what SETTLED actually rests on.
 */
export class ScryptOrderStuckPendingError extends Error {}

/**
 * An amend the venue refused. The replacement was never created, so the ORIGINAL order is still live — and
 * its reference is spent, because the venue requires references to be unique. Carries it so the caller can
 * record it and derive a fresh one next time instead of reusing a burnt reference forever.
 */
export class ScryptAmendRejectedError extends Error {
  constructor(
    message: string,
    readonly spentReference: string | undefined,
  ) {
    super(message);
  }
}

/**
 * The venue sent an explicit error in reply to one specific request.
 *
 * Deliberately NOT a rejection: `unknown reqid` arrives the same way and means the venue lost our request
 * context, which for a mutation is as open as silence. Callers that can tell the two apart narrow it; callers
 * that cannot must keep treating it as an unresolved outcome.
 */
export class ScryptErrorResponseError extends Error {}

/**
 * The venue replied and refused the request. This is the ONLY evidence that a write did not take effect —
 * everything else leaves the outcome open.
 *
 * A type rather than a set of message patterns: a rejection is now impossible to miss by phrasing a message
 * differently, and impossible to fake by a transport error that happens to contain the word. Every path that
 * turns a venue refusal into an exception must use this type, or the caller will retry a settled outcome
 * forever.
 */
export class ScryptVenueRejectionError extends Error {}

export function isVenueRejection(e: Error): boolean {
  return e instanceof ScryptVenueRejectionError;
}

interface ScryptRequest {
  reqid?: number;
  type: ScryptRequestType | ScryptMessageType;
  streams?: Array<{ name: string; [key: string]: any }>;
  data?: any[];
}

interface PendingRequest {
  resolve: (value: ScryptMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

type SubscriptionCallback = (data: any) => void;
type UnsubscribeFunction = () => void;

export class ScryptWebSocketConnection {
  private readonly logger = new DfxLogger(ScryptWebSocketConnection);

  private ws?: WebSocket;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private connectionPromise?: Promise<void>;
  private connectionGeneration = 0;

  private readonly reconnectDelay = 5000; // 5 seconds
  private readonly maxReconnectDelay = 60000; // 60s cap for the exponential backoff
  private readonly handshakeTimeoutMs = 15000;
  private hasEverConnected = false; // gates the reconnect catch-up callbacks; resubscription is decided by hasOrphanedStreams()
  private isReconnecting = false; // guards against overlapping reconnect loops
  private loggedUndialableWsUrl = false; // an unretryable URL is reported once, not on every failed attempt
  private reconnectEpoch = 0; // bumped on disconnect / new loop so stale scheduleReconnect continuations no-op
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectCallbacks: Array<() => void | Promise<void>> = [];

  // requests
  private reqIdCounter = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();

  // streaming
  private subscriptions: Map<ScryptMessageType, Set<SubscriptionCallback>> = new Map();
  private activeStreams: Set<ScryptMessageType> = new Set();
  // Streams whose own subscribe() call is still awaiting connect(): it sends its SUBSCRIBE as soon as the
  // connect resolves, so establishConnection must NOT restore those (that would double-send). Everything else
  // in activeStreams is orphaned — nobody is waiting to send it — and only we can put it back on the socket.
  // Claims are per CALL, not per stream: two calls can hold the same stream at once (one dying, one live), so
  // each releases only its own token. A flag or a count cannot express that once disconnect() clears the map —
  // the superseded call's release would then consume the newer call's claim, and resubscribeToStreams would
  // restore a stream whose owner is about to send it too.
  private pendingOwnerSubscribes: Map<ScryptMessageType, Set<number>> = new Map();
  private subscribeClaimSeq = 0;
  // Filters belong to the stream, not to the one call that first sent it: restoring a stream without them would
  // silently widen the subscription (#4310 finding H). Harmless while every subscription is unfiltered, but
  // restoring is now also the healing path for a first subscribe, so the trap is one filtered caller away.
  // Note for the first filtered caller: a cursor-style filter is replayed verbatim, so a StartDate frozen at
  // subscribe time re-delivers from that date on every restore — such a filter must be re-derived here instead.
  private streamFilters: Map<ScryptMessageType, Record<string, unknown>> = new Map();

  constructor(
    private readonly wsUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  // --- PUBLIC METHODS --- //

  async send(type: ScryptMessageType, data: any[]): Promise<void> {
    return this.notify({ type, data });
  }

  async fetch<T>(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<T[]> {
    const doFetch = async (): Promise<T[]> => {
      const reqId = ++this.reqIdCounter;
      try {
        const response = await this.requestWithId(reqId, {
          type: ScryptRequestType.SUBSCRIBE,
          streams: [{ name: streamName, ...filters }],
        });

        if (!response.initial) throw new Error(`Expected initial ${streamName} message`);

        return (response.data ?? []) as T[];
      } finally {
        this.sendCancel(reqId);
      }
    };

    return this.retryIdempotentRead(doFetch, `fetch ${streamName}`);
  }

  async fetchAll<T>(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<T[]> {
    const doFetch = async (): Promise<T[]> => {
      const allData: T[] = [];
      const reqId = ++this.reqIdCounter;

      try {
        // First request
        let response = await this.requestWithId(reqId, {
          type: ScryptRequestType.SUBSCRIBE,
          streams: [{ name: streamName, ...filters }],
        });

        if (!response.initial) throw new Error(`Expected initial ${streamName} message`);

        allData.push(...((response.data ?? []) as T[]));

        // Paginate through all pages
        while (response.next) {
          response = await this.requestWithId(reqId, {
            type: ScryptRequestType.PAGE,
            streams: [{ name: streamName, after: response.next }],
          });

          allData.push(...((response.data ?? []) as T[]));
        }

        return allData;
      } finally {
        this.sendCancel(reqId);
      }
    };

    return this.retryIdempotentRead(doFetch, `fetchAll ${streamName}`);
  }

  // Register a callback fired after every reconnect, plus a first connect that healed an earlier failed attempt
  // (but not a clean first connect). Used to re-fetch state that a bare re-subscribe does not replay (see
  // ScryptService catch-up). Callbacks must not throw / handle their own errors.
  onReconnect(callback: () => void | Promise<void>): void {
    this.reconnectCallbacks.push(callback);
  }

  /**
   * Retry wrapper for IDEMPOTENT READS ONLY — `fetch` and `fetchAll`. Never widen this to a call that can
   * create, amend or cancel an order, or move funds: it retries on timeout, and a timed-out write may
   * already have been executed by the venue. Write paths must surface the timeout so the caller can treat
   * the outcome as unknown (see OrderOutcomeUnknownException in the liquidity-management subdomain).
   */
  private async retryIdempotentRead<T>(operation: () => Promise<T>, label: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // A read that went unanswered is safe to repeat: re-subscribing to a snapshot stream has no side
      // effect at the venue. Without this, a single silent 30s window ends the whole liquidity order.
      if (isTransientWsError(error) || error instanceof ScryptRequestTimeoutError) {
        this.logger.warn(`Retrying ${label} after transient error: ${error.message}`);
        return operation();
      }
      throw error;
    }
  }

  async requestAndWaitForUpdate<T>(
    type: ScryptMessageType,
    data: any[],
    streamName: ScryptMessageType,
    matcher: (data: T[]) => T | null,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new ScryptRequestTimeoutError(`Timeout waiting for ${streamName} update after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsubscribe = this.subscribe(streamName, (data) => {
        const match = matcher(data as T[]);
        if (match) {
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(match);
        }
      });

      this.request({ type, data }, timeoutMs).catch((error) => {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration++; // supersede any in-flight connect attempt (its socket events become no-ops)
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.isReconnecting = false;
    this.hasEverConnected = false; // full reset: a later reuse starts over, with no catch-up owed on its first connect
    this.reconnectEpoch++; // supersede any in-flight reconnect loop (stale timer/then/catch become no-ops)
    this.connectionState = ConnectionState.DISCONNECTED;
    this.connectionPromise = undefined;

    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
    this.subscriptions.clear();
    this.activeStreams.clear();
    // Claims of superseded calls go with them. Leaving them would suppress the restore of a stream that a new
    // subscribe re-registers before the old call finishes settling — which can take until its handshake times
    // out. Safe because each call releases only its own token, so this cannot free a newer call's claim.
    this.pendingOwnerSubscribes.clear();
    this.streamFilters.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  // --- CONNECTION MANAGEMENT --- //

  private async connect(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) return;
    if (this.connectionState === ConnectionState.CONNECTING && this.connectionPromise) return this.connectionPromise;

    const generation = ++this.connectionGeneration;
    this.connectionState = ConnectionState.CONNECTING;
    const promise = this.establishConnection(generation);
    this.connectionPromise = promise;
    try {
      await promise;
    } catch (error) {
      // Only the owner of the current in-flight promise may reset state — a late reject from a
      // stale establish must not clobber a newer attempt that already installed its own promise.
      if (this.connectionPromise === promise) {
        this.connectionState = ConnectionState.DISCONNECTED;
        this.connectionPromise = undefined;
        // A FAILED attempt leaves no socket, so no close event with wasConnected=true will ever arrive to arm
        // handleDisconnection's loop (#4310 finding A). If we owe the venue subscriptions, the backoff loop is
        // the only thing that can restore them — without this, a failed first connect stays dead until restart.
        this.ensureReconnectLoop();
      }
      throw error;
    }
  }

  // Start the backoff loop unless one is already running. Only when streams are outstanding: a bare failed
  // request has a caller who will retry on its own, and looping for it would reconnect for nobody.
  private ensureReconnectLoop(): void {
    if (this.isReconnecting || this.activeStreams.size === 0) return;

    // A URL we cannot dial fails identically on every attempt, so a loop would warn forever without ever being
    // able to connect. Say so once and stay down: this needs a config change, not a retry. The message names
    // all three causes, because an unsupported scheme and a stray fragment both parse perfectly and would
    // otherwise send the operator hunting for a typo that is not there.
    if (!isDialableWsUrl(this.wsUrl)) {
      if (!this.loggedUndialableWsUrl) {
        this.loggedUndialableWsUrl = true;
        this.logger.error(
          'Scrypt WebSocket URL is not dialable (unparseable, unsupported scheme or URL fragment) — not scheduling reconnects',
        );
      }
      return;
    }

    this.isReconnecting = true;
    this.scheduleReconnect(0, ++this.reconnectEpoch);
  }

  // Streams that are supposed to be on the socket but have no subscribe() call waiting to send them.
  private hasOrphanedStreams(): boolean {
    for (const streamName of this.activeStreams) {
      if (!this.isStreamClaimed(streamName)) return true;
    }

    return false;
  }

  // True while at least one subscribe() call is still awaiting a connect for this stream and will send it itself.
  private isStreamClaimed(streamName: ScryptMessageType): boolean {
    return (this.pendingOwnerSubscribes.get(streamName)?.size ?? 0) > 0;
  }

  // Full readiness. Everything awaiting connect()/connectionPromise waits for ALL of this, so no caller can send
  // on a socket whose streams are not yet restored (#4310 finding 1); a drop at any step rejects so the caller /
  // backoff loop retries instead of treating a dead socket as connected (finding 2). connectionState stays
  // CONNECTING until the very end, so a business call arriving mid-resubscribe joins connectionPromise (via
  // connect()'s CONNECTING branch) rather than proceeding on the half-ready socket.
  private async establishConnection(generation: number): Promise<void> {
    const wasEverConnected = this.hasEverConnected;
    // rejects on error or handshake timeout; a close-before-open without an error is bounded by the
    // handshake timeout (it does not itself reject)
    await this.connectWebSocket(generation);
    this.assertCurrentGeneration(generation);
    this.assertSocketOpen('after handshake');

    // Restore every stream no subscribe() call is waiting to send. On a genuine first connect each active
    // stream still has its owner queued behind this promise, so there is nothing to restore here and nothing
    // gets sent twice; after a failed attempt those owners are gone and only this call can revive the streams.
    const hasRestoredStreams = this.hasOrphanedStreams();
    if (hasRestoredStreams) {
      await this.resubscribeToStreams(); // sends on the current socket directly, no ensureConnected (no reentrancy)
      this.assertCurrentGeneration(generation);
      this.assertSocketOpen('after resubscription');
    }

    this.hasEverConnected = true;
    this.connectionState = ConnectionState.CONNECTED; // fully ready only now
    // We are fully connected — clear any reconnect loop, whether it healed us or a business call did.
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    // Restoring orphaned streams counts as a reconnect even when no connect ever completed before: the
    // constructor warm-up died with the failed attempt, so the caches are owed the same catch-up as after a drop.
    if (wasEverConnected || hasRestoredStreams) this.fireReconnectCallbacks();
  }

  private fireReconnectCallbacks(): void {
    for (const cb of this.reconnectCallbacks) {
      try {
        void Promise.resolve(cb()).catch((e) => this.logger.error('Scrypt onReconnect callback rejected:', e));
      } catch (e) {
        this.logger.error('Scrypt onReconnect callback failed:', e);
      }
    }
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.connectionGeneration) throw new Error('Scrypt WebSocket connection attempt superseded');
  }

  private assertSocketOpen(when: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error(`Scrypt WebSocket is not open ${when}`);
  }

  private async ensureConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.connectionState === ConnectionState.CONNECTED) {
      return this.ws;
    }

    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // connect() short-circuits on a CONNECTED state whose socket is already closing, so it resolves without
      // having reconnected and its catch never runs. Arm here too, or a business call that lands in this window
      // leaves the streams down until the socket's own close event finally arrives.
      this.ensureReconnectLoop();
      throw new Error('WebSocket connection failed');
    }

    return this.ws;
  }

  private async connectWebSocket(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.wsUrl);
      const host = url.host;
      const path = url.pathname;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const signaturePayload = ['GET', timestamp, host, path].join('\n');
      const signature = Util.createHmac(this.apiSecret, signaturePayload, 'sha256', 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const headers = {
        ApiKey: this.apiKey,
        ApiSign: signature,
        ApiTimestamp: timestamp,
      };

      const ws = new WebSocket(this.wsUrl, { headers });
      const handshakeTimeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Scrypt WebSocket handshake timed out after ${this.handshakeTimeoutMs}ms`));
      }, this.handshakeTimeoutMs);

      ws.on('open', () => {
        clearTimeout(handshakeTimeout);
        if (generation !== this.connectionGeneration) {
          ws.terminate(); // a newer attempt or disconnect() superseded us — do not adopt this socket
          reject(new Error('Scrypt WebSocket connection attempt superseded'));
          return;
        }
        this.ws = ws;
        resolve();
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      ws.on('error', (error) => {
        clearTimeout(handshakeTimeout);
        this.logger.error('Scrypt WebSocket error:', error);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        this.handleDisconnection(generation, code, reason);
      });
    });
  }

  private handleDisconnection(generation: number, code?: number, reason?: string): void {
    if (generation !== this.connectionGeneration) return; // stale socket — its close is not our concern

    // Only flip to DISCONNECTED when the live socket dropped. A mid-establish close (CONNECTING)
    // must leave state alone so concurrent connect() callers still join connectionPromise instead
    // of starting a second establishConnection.
    const wasConnected = this.connectionState === ConnectionState.CONNECTED;
    if (wasConnected) this.connectionState = ConnectionState.DISCONNECTED;
    this.ws = undefined;

    // reject pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    // Log every close of a live socket, independently of whether it is this event that arms the loop. Since
    // subscribe() and ensureConnected() can arm first, folding the two together would drop the close code and
    // reason exactly in the windows where they are armed — and that line is the outage signal on a flapping
    // connection (finding G).
    if (wasConnected) {
      this.logger.warn(`Scrypt WebSocket closed (code: ${code}, reason: ${reason})`);

      if (!this.isReconnecting) {
        this.isReconnecting = true;
        this.scheduleReconnect(0, ++this.reconnectEpoch);
      }
    }
  }

  private scheduleReconnect(attempt: number, epoch: number): void {
    const capped = Math.min(this.reconnectDelay * 2 ** attempt, this.maxReconnectDelay);
    const delay = capped / 2 + Math.random() * (capped / 2); // equal jitter to avoid synchronized retry storms
    if (attempt > 0 && attempt % 10 === 0)
      this.logger.error(`Scrypt WebSocket still not reconnected after ${attempt} attempts`);
    this.reconnectTimer = setTimeout(() => {
      if (epoch !== this.reconnectEpoch) return; // this loop was superseded (disconnect or a newer loop)
      // Everything we owed was unsubscribed while this timer waited. Stand down instead of holding a socket
      // open that nobody reads — the arm-time guard cannot see a set that empties later.
      if (this.activeStreams.size === 0) {
        this.isReconnecting = false;
        return;
      }
      void this.connect()
        .then(() => {
          if (epoch !== this.reconnectEpoch) return;
          // connect() short-circuits on a CONNECTED state whose socket is already closing, so resolving is not
          // proof of a live socket. Declaring success there would disarm the loop and log a reconnect that never
          // happened — the outage signal #4310 finding G asked for. Use ensureConnected's readiness definition.
          if (this.connectionState !== ConnectionState.CONNECTED || this.ws?.readyState !== WebSocket.OPEN) {
            this.scheduleReconnect(attempt + 1, epoch);
            return;
          }
          this.isReconnecting = false;
          this.logger.info(`Scrypt WebSocket reconnected (after ${attempt + 1} attempt(s))`);
        })
        .catch((error) => {
          if (epoch !== this.reconnectEpoch) return;
          this.logger.warn(`Scrypt WebSocket reconnect attempt ${attempt + 1} failed; retrying`, error);
          this.scheduleReconnect(attempt + 1, epoch);
        });
    }, delay);
  }

  // --- REQUEST/RESPONSE --- //

  private async notify(message: ScryptRequest): Promise<void> {
    const ws = await this.ensureConnected();

    const reqId = ++this.reqIdCounter;
    const request: ScryptRequest = { ...message, reqid: reqId };

    ws.send(JSON.stringify(request));
  }

  private async request(message: ScryptRequest, timeoutMs = 30000): Promise<ScryptMessage> {
    const reqId = ++this.reqIdCounter;
    return this.requestWithId(reqId, message, timeoutMs);
  }

  private async requestWithId(reqId: number, message: ScryptRequest, timeoutMs = 30000): Promise<ScryptMessage> {
    const ws = await this.ensureConnected();

    const request: ScryptRequest = { ...message, reqid: reqId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new ScryptRequestTimeoutError(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });
      ws.send(JSON.stringify(request));
    });
  }

  private handleRequestResponse(message: ScryptMessage): void {
    if (message.reqid === undefined) return;

    const request = this.pendingRequests.get(message.reqid);
    if (!request) return;

    clearTimeout(request.timeout);
    this.pendingRequests.delete(message.reqid);

    if (message.type === ScryptMessageType.ERROR) {
      const errorMsg = typeof message.error === 'object' ? JSON.stringify(message.error) : message.error;
      // The venue answered this specific request negatively. Whether that settles the outcome depends on the
      // reason — a malformed order is settled, a lost session is not — and Scrypt does not document its
      // codes, so this stays a distinct type and the caller decides. Never silently a plain Error: that is
      // what let a refusal look like a transport hiccup.
      request.reject(new ScryptErrorResponseError(`Scrypt error: ${errorMsg}`));
    } else {
      request.resolve(message);
    }
  }

  // Stop an ad-hoc fetch/fetchAll stream by its request id (venue: cancel-by-reqid, no response). Best-effort:
  // if the socket is not open the server-side stream is moot anyway; never throw (must not affect the fetch result).
  private sendCancel(reqId: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ reqid: reqId, type: ScryptRequestType.CANCEL }));
    } catch (e) {
      this.logger.error(`Failed to cancel Scrypt stream ${reqId}:`, e);
    }
  }

  // --- STREAMING SUBSCRIPTIONS --- //

  /**
   * Safe to call for a stream that is already active (it only adds a callback — no new SUBSCRIBE is
   * sent). Also safe while the connection is down or reconnecting: the stream is claimed in
   * pendingOwnerSubscribes for the duration of the connect, so an in-flight reconnect leaves it to
   * this call and the SUBSCRIBE frame goes out exactly once.
   */
  subscribeToStream<T>(
    streamName: ScryptMessageType,
    callback: (data: T[]) => void,
    filters?: Record<string, unknown>,
  ): UnsubscribeFunction {
    return this.subscribe(streamName, callback as SubscriptionCallback, filters);
  }

  private subscribe(
    streamName: ScryptMessageType,
    callback: SubscriptionCallback,
    filters?: Record<string, unknown>,
  ): UnsubscribeFunction {
    // add callback
    if (!this.subscriptions.has(streamName)) {
      this.subscriptions.set(streamName, new Set());
    }

    const callbacks = this.subscriptions.get(streamName);
    callbacks.add(callback);

    // send subscription
    if (!this.activeStreams.has(streamName)) {
      this.activeStreams.add(streamName);
      if (filters) this.streamFilters.set(streamName, filters);
      this.sendSubscription(streamName, filters).catch((error) => {
        this.logger.error(`Failed to subscribe to ${streamName}:`, error);
        // Keep it in activeStreams so the backoff loop restores it, exactly as resubscribeToStreams does on a
        // mid-resubscribe drop. Dropping it here is what made a failed first connect permanent (#4310 finding A):
        // the stream was gone before any reconnect could put it back.
        this.ensureReconnectLoop();
      });
    }

    // return unsubscribe
    return () => {
      const callbacks = this.subscriptions.get(streamName);
      if (callbacks) {
        callbacks.delete(callback);

        if (callbacks.size === 0) {
          this.subscriptions.delete(streamName);
          this.activeStreams.delete(streamName);
          this.streamFilters.delete(streamName);
          this.sendUnsubscription(streamName).catch((error) => {
            this.logger.error(`Failed to unsubscribe from ${streamName}:`, error);
          });
        }
      }
    };
  }

  private async sendSubscription(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<void> {
    // Claim the stream for the duration of the connect so a concurrent establishConnection leaves it to us.
    const claim = ++this.subscribeClaimSeq;
    const claims = this.pendingOwnerSubscribes.get(streamName) ?? new Set<number>();
    claims.add(claim);
    this.pendingOwnerSubscribes.set(streamName, claims);

    try {
      await this.ensureConnected();
      this.sendSubscriptionOnSocket(streamName, filters);
    } finally {
      // Release only our own token: disconnect() may have dropped this claim and a newer call may have
      // re-registered the same stream in the meantime.
      const held = this.pendingOwnerSubscribes.get(streamName);
      held?.delete(claim);
      if (held && held.size === 0) this.pendingOwnerSubscribes.delete(streamName);
    }
  }

  // Send a SUBSCRIBE frame on the CURRENT socket, used during (re)connection where ensureConnected must not be
  // called (connectionState is still CONNECTING). Throws if the socket is not open so a mid-resubscribe drop is
  // detectable by establishConnection's assertSocketOpen.
  private sendSubscriptionOnSocket(streamName: ScryptMessageType, filters?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Scrypt WebSocket is not open');
    this.ws.send(
      JSON.stringify({
        reqid: ++this.reqIdCounter,
        type: ScryptRequestType.SUBSCRIBE,
        streams: [{ name: streamName, ...filters }],
      }),
    );
  }

  private async sendUnsubscription(streamName: ScryptMessageType): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const request: ScryptRequest = {
      reqid: ++this.reqIdCounter,
      type: ScryptRequestType.UNSUBSCRIBE,
      streams: [{ name: streamName }],
    };

    this.ws.send(JSON.stringify(request));
  }

  private handleSubscriptionUpdate(message: ScryptMessage): void {
    if (!message.type) return;

    const callbacks = this.subscriptions.get(message.type);
    if (!callbacks || callbacks.size === 0) return;

    callbacks.forEach((callback) => {
      try {
        callback(message.data);
      } catch (error) {
        this.logger.error(`Subscription callback error for ${message.type}:`, error);
      }
    });
  }

  private async resubscribeToStreams(): Promise<void> {
    for (const streamName of this.activeStreams) {
      if (this.isStreamClaimed(streamName)) continue; // its subscribe() sends once this connect resolves
      try {
        // throws if the socket isn't open; caught + logged, kept for retry
        this.sendSubscriptionOnSocket(streamName, this.streamFilters.get(streamName));
      } catch (error) {
        this.logger.error(`Failed to resubscribe to ${streamName}:`, error);
        // keep it in activeStreams so the next reconnect retries it (do not drop it)
      }
    }
  }

  // --- MESSAGE HANDLING --- //

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: ScryptMessage = JSON.parse(data.toString());

      // handle request/response
      if (message.reqid !== undefined && this.pendingRequests.has(message.reqid)) {
        this.handleRequestResponse(message);
        return;
      }

      // handle streaming
      if (message.type && this.subscriptions.has(message.type)) {
        this.handleSubscriptionUpdate(message);
        return;
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message:', error);
    }
  }
}
