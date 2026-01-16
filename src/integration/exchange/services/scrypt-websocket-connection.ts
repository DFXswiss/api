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
}

export enum ScryptMessageType {
  NEW_WITHDRAW_REQUEST = 'NewWithdrawRequest',
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

  private readonly reconnectDelay = 5000; // 5 seconds

  // requests
  private reqIdCounter = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();

  // streaming
  private subscriptions: Map<ScryptMessageType, Set<SubscriptionCallback>> = new Map();
  private activeStreams: Set<ScryptMessageType> = new Set();

  constructor(
    private readonly wsUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  // --- PUBLIC METHODS --- //

  async fetch<T>(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<T[]> {
    const response = await this.request({
      type: ScryptRequestType.SUBSCRIBE,
      streams: [{ name: streamName, ...filters }],
    });

    if (!response.initial) throw new Error(`Expected initial ${streamName} message`);

    return (response.data ?? []) as T[];
  }

  async requestAndWaitForUpdate<T>(
    request: ScryptRequest,
    streamName: ScryptMessageType,
    matcher: (data: T[]) => T | null,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for ${streamName} update after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsubscribe = this.subscribe(streamName, (data) => {
        const match = matcher(data as T[]);
        if (match) {
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(match);
        }
      });

      this.request(request, timeoutMs).catch((error) => {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return;

    this.connectionState = ConnectionState.DISCONNECTED;
    this.ws.close();
    this.ws = undefined;

    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    this.subscriptions.clear();
    this.activeStreams.clear();
  }

  // --- CONNECTION MANAGEMENT --- //

  private async connect(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) return;

    if (this.connectionState === ConnectionState.CONNECTING && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionState = ConnectionState.CONNECTING;
    this.connectionPromise = this.connectWebSocket();

    try {
      await this.connectionPromise;
      this.connectionState = ConnectionState.CONNECTED;
    } catch (error) {
      this.connectionState = ConnectionState.DISCONNECTED;
      this.connectionPromise = undefined;
      throw error;
    }
  }

  private async ensureConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.connectionState === ConnectionState.CONNECTED) {
      return this.ws;
    }

    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket connection failed');
    }

    return this.ws;
  }

  private async connectWebSocket(): Promise<void> {
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

      ws.on('open', () => {
        this.ws = ws;
        resolve();
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      ws.on('error', (error) => {
        this.logger.error('Scrypt WebSocket error:', error);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        this.logger.warn(`Scrypt WebSocket closed (code: ${code}, reason: ${reason})`);
        this.handleDisconnection();
      });
    });
  }

  private handleDisconnection(): void {
    const wasConnected = this.connectionState === ConnectionState.CONNECTED;
    this.connectionState = ConnectionState.DISCONNECTED;
    this.ws = undefined;

    // reject pending requests
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    // reconnect
    if (wasConnected) {
      this.logger.warn(`Unexpected disconnection, attempting reconnect in ${this.reconnectDelay}ms`);

      setTimeout(() => {
        void this.connect()
          .then(() => this.resubscribeToStreams())
          .catch((error) => this.logger.error('Reconnection failed:', error));
      }, this.reconnectDelay);
    }
  }

  // --- REQUEST/RESPONSE --- //

  private async request(message: ScryptRequest, timeoutMs = 30000): Promise<ScryptMessage> {
    const ws = await this.ensureConnected();

    const reqId = ++this.reqIdCounter;
    const request: ScryptRequest = { ...message, reqid: reqId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
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
      request.reject(new Error(`Scrypt error: ${errorMsg}`));
    } else {
      request.resolve(message);
    }
  }

  // --- STREAMING SUBSCRIPTIONS --- //

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
      this.sendSubscription(streamName, filters).catch((error) => {
        this.logger.error(`Failed to subscribe to ${streamName}:`, error);
        this.activeStreams.delete(streamName);
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
          this.sendUnsubscription(streamName).catch((error) => {
            this.logger.error(`Failed to unsubscribe from ${streamName}:`, error);
          });
        }
      }
    };
  }

  private async sendSubscription(streamName: ScryptMessageType, filters?: Record<string, unknown>): Promise<void> {
    const ws = await this.ensureConnected();

    const request: ScryptRequest = {
      reqid: ++this.reqIdCounter,
      type: ScryptRequestType.SUBSCRIBE,
      streams: [
        {
          name: streamName,
          ...filters,
        },
      ],
    };

    ws.send(JSON.stringify(request));
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
    const streams = Array.from(this.activeStreams);
    this.activeStreams.clear();

    for (const streamName of streams) {
      try {
        await this.sendSubscription(streamName);
        this.activeStreams.add(streamName);
      } catch (error) {
        this.logger.error(`Failed to resubscribe to ${streamName}:`, error);
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
