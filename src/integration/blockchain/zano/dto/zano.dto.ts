export interface ZanoAddressDto {
  address: string;
  depositAddress?: ZanoDepositAddressDto;
}

export interface ZanoDepositAddressDto {
  address: string;
  paymentId: string;
  accountIndex?: number;
}

export interface ZanoGetBalanceResultDto {
  balance: number;
  unlocked_balance: number;
  balances: ZanoBalancesDto[];
}

export interface ZanoBalancesDto {
  asset_info: ZanoAssetInfoDto;
  total: number;
  unlocked: number;
}

export interface ZanoGetTransactionResultDto {
  id: string;
  keeper_block: number;
  amount: number;
  fee: number;
  status: string;
  timestamp: string;
}

export interface ZanoTransactionDto {
  id: string;
  block: number;
  amount: number;
  fee: number;
  status: string;
  timestamp: string;
}

export interface ZanoGetTransferResultDto {
  tx_type: number;
  tx_hash: string;
  payment_id: string;
  height: number;
  fee: number;
  remote_addresses?: string[];
  timestamp: number;
  employed_entries: {
    ['receive']: ZanoGetTransferEmployedEntryDto[];
    ['spent']?: ZanoGetTransferEmployedEntryDto[];
  };
}

export interface ZanoGetTransferEmployedEntryDto {
  amount: number;
  asset_id: string;
  index: number;
}

export interface ZanoTransferDto {
  block: number;
  txId: string;
  txType: number;
  fee: number;
  timestamp: number;
  receive: ZanoTransferReceiveDto[];
  paymentId?: string;
  accountIndex?: number;
}

export interface ZanoTransferReceiveDto {
  amount: number;
  assetId: string;
}

export interface ZanoSendTransferResultDto {
  txId: string;
  amount: number;
  fee: number;
}

export interface ZanoAssetInfoDto {
  asset_id: string;
  decimal_point: number;
  full_name: string;
  ticker: string;
}

export interface ZanoAssetWhitelistResultDto {
  global_whitelist: ZanoAssetInfoDto[];
  local_whitelist: ZanoAssetInfoDto[];
  own_assets: ZanoAssetInfoDto[];
}
