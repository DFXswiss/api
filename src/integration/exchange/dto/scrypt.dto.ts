// --- TRANSACTION TYPES --- //

export enum ScryptTransactionType {
  WITHDRAWAL = 'Withdrawal',
  DEPOSIT = 'Deposit',
}

export enum ScryptTransactionStatus {
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  REJECTED = 'Rejected',
}

export interface ScryptBalance {
  Currency: string;
  Amount: string;
  AvailableAmount: string;
  Equivalent?: {
    Currency: string;
    Amount: string;
    AvailableAmount: string;
  };
}

export interface ScryptBalanceTransaction {
  TransactionID: string;
  ClReqID?: string;
  Currency: string;
  TransactionType: ScryptTransactionType;
  Status: ScryptTransactionStatus;
  Quantity: string;
  Fee?: string;
  TxHash?: string;
  RejectReason?: string;
  RejectText?: string;
  Timestamp?: string;
  TransactTime?: string;
}

export interface ScryptWithdrawResponse {
  id: string;
  status: ScryptTransactionStatus;
}

export interface ScryptWithdrawStatus {
  id: string;
  status: ScryptTransactionStatus;
  txHash?: string;
  amount?: number;
  rejectReason?: string;
  rejectText?: string;
}

// --- TRADE TYPES --- //

export enum ScryptTradeSide {
  BUY = 'Buy',
  SELL = 'Sell',
}

export enum ScryptTradeStatus {
  PENDING = 'Pending',
  CONFIRMED = 'Confirmed',
  CANCELED = 'Canceled',
}

export interface ScryptTrade {
  Timestamp: string;
  Symbol: string;
  OrderID: string;
  TradeID: string;
  Side: ScryptTradeSide;
  TransactTime: string;
  ExecType: string;
  Currency: string;
  Price?: string;
  Quantity: string;
  Amount: string;
  Fee: string;
  FeeCurrency?: string;
  TradeStatus: ScryptTradeStatus;
  AmountCurrency: string;
  QuoteID?: string;
  RFQID?: string;
  CustomerUser?: string;
  AggressorSide?: ScryptTradeSide;
  DealtCurrency?: string;
}

// --- ORDER TYPES --- //

export enum ScryptOrderStatus {
  NEW = 'New',
  PARTIALLY_FILLED = 'PartiallyFilled',
  FILLED = 'Filled',
  CANCELLED = 'Cancelled',
  REJECTED = 'Rejected',
}

export enum ScryptOrderSide {
  BUY = 'Buy',
  SELL = 'Sell',
}

export enum ScryptOrderType {
  MARKET = 'Market',
  LIMIT = 'Limit',
}

export enum ScryptTimeInForce {
  FILL_AND_KILL = 'FillAndKill',
  FILL_OR_KILL = 'FillOrKill',
  GOOD_TILL_CANCEL = 'GoodTillCancel',
}

export interface ScryptExecutionReport {
  ClOrdID: string;
  OrigClOrdID?: string;
  OrderID?: string;
  Symbol: string;
  Side: string;
  OrdStatus: ScryptOrderStatus;
  ExecType?: string;
  OrderQty: string;
  CumQty: string;
  LeavesQty: string;
  AvgPx?: string;
  Price?: string;
  RejectReason?: string;
  Text?: string;
}

export interface ScryptOrderResponse {
  id: string;
  status: ScryptOrderStatus;
}

export interface ScryptOrderInfo {
  id: string;
  orderId?: string;
  symbol: string;
  side: string;
  status: ScryptOrderStatus;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  avgPrice?: number;
  price?: number;
  rejectReason?: string;
}

// --- MARKET DATA TYPES --- //

export interface ScryptPriceLevel {
  Price: string;
  Size: string;
}

export interface ScryptMarketDataSnapshot {
  Timestamp: string;
  Symbol: string;
  Status: string;
  Bids: ScryptPriceLevel[];
  Offers: ScryptPriceLevel[];
}

export interface ScryptOrderBook {
  bids: Array<{ price: number; size: number }>;
  offers: Array<{ price: number; size: number }>;
}

// --- SECURITY TYPES --- //

export interface ScryptSecurity {
  Symbol: string;
  MinimumSize?: string;
  MaximumSize?: string;
  MinPriceIncrement?: string;
  MinSizeIncrement?: string;
}

export interface ScryptSecurityInfo {
  symbol: string;
  minSize: number;
  maxSize: number;
  minPriceIncrement: number;
  minSizeIncrement: number;
}
