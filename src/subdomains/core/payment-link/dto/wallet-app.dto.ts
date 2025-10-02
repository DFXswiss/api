import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum WalletAppId {
  DEUROWALLET = 'deurowallet',
  CAKEWALLET = 'cakewallet',
  FRANKENCOIN = 'frankencoin',
  PHOENIX = 'phoenix',
  WALLETOFSATOSHI = 'walletofsatoshi',
  BTC_TARO = 'btctaro',
  BITBANANA = 'bitbanana',
  BITKIT = 'bitkit',
  BLINK = 'blink',
  BLITZWALLET = 'blitzwallet',
  BLIXT = 'blixt',
  BREEZ = 'breez',
  COINCORNER = 'coincorner',
  LIFPAY = 'lifpay',
  LIPAWALLET = 'lipawallet',
  LNBITS = 'lnbits',
  AQUA = 'aqua',
  ONEKEY = 'onekey',
  POUCHPH = 'pouchph',
  ZEBEDEE = 'zebedee',
  ZEUS = 'zeus',
  BINANCE = 'binance',
  MUUN = 'muun',
  KUCOINPAY = 'kucoinpay',
  BRIDGEWALLET = 'bridgewallet',
}

export class WalletAppDto {
  @ApiProperty({ enum: WalletAppId })
  id: WalletAppId;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  websiteUrl?: string;

  @ApiProperty()
  iconUrl: string;

  @ApiPropertyOptional()
  deepLink?: string;

  @ApiPropertyOptional()
  hasActionDeepLink?: boolean;

  @ApiPropertyOptional()
  appStoreUrl?: string;

  @ApiPropertyOptional()
  playStoreUrl?: string;

  @ApiPropertyOptional()
  recommended?: boolean;

  @ApiProperty({ type: [String] })
  supportedMethods: string[];

  @ApiPropertyOptional({ type: [String] })
  supportedTokens?: string[];

  @ApiPropertyOptional()
  semiCompatible?: boolean;

  @ApiPropertyOptional()
  disabled?: boolean;
}
