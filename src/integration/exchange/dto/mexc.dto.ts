export enum DepositStatus {
  SMALL = 1,
  TIME_DELAY = 2,
  LARGE_DELAY = 3,
  PENDING = 4,
  SUCCESS = 5,
  AUDITING = 6,
  REJECTED = 7,
  REFUND = 8,
  PRE_SUCCESS = 9,
  INVALID = 10,
  RESTRICTED = 11,
  COMPLETED = 12,
}

export interface Deposit {
  amount: string;
  coin: string;
  network: string;
  status: DepositStatus;
  address: string;
  addressTag?: string;
  txId: string;
  transHash: string;
  insertTime: number;
  updateTime: number;
  unlockConfirm: string;
  confirmTimes: string;
  memo?: string;
}

export enum WithdrawalStatus {
  APPLY = 1,
  AUDITING = 2,
  WAIT = 3,
  PROCESSING = 4,
  WAIT_PACKAGING = 5,
  WAIT_CONFIRM = 6,
  SUCCESS = 7,
  FAILED = 8,
  CANCEL = 9,
  MANUAL = 10,
}

export interface Withdrawal {
  id: string;
  txId: string | null;
  coin: string;
  network: string;
  address: string;
  amount: string;
  transferType: number;
  status: WithdrawalStatus;
  transactionFee: string;
  confirmNo: number | null;
  applyTime: number;
  remark: string;
  memo: string;
  transHash: string;
  updateTime: number;
  coinId: string;
  vcoinId: string;
}

// --- ZCHF Assessment Period - can be removed once assessment ends --- //
export interface MexcSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  baseCommissionPrecision: number;
  quoteCommissionPrecision: number;
  orderTypes: string[];
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  quoteAmountPrecision: string;
  baseSizePrecision: string;
  permissions: string[];
  filters: unknown[];
  maxQuoteAmount: string;
  makerCommission: string;
  takerCommission: string;
  quoteAmountPrecisionMarket: string;
  maxQuoteAmountMarket: string;
  fullName: string;
}

export interface MexcExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: unknown[];
  exchangeFilters: unknown[];
  symbols: MexcSymbol[];
}

export interface MexcOrderBook {
  lastUpdateId: number;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][]; // [price, quantity]
}

export interface MexcTrade {
  id: number | null;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}
