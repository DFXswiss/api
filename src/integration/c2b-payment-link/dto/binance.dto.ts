export interface PaymentInfo {
    payMethod: string;
    paymentInstructions: {
        currency: string;
        amount: number;
        price: number;
    }[];
    channel?: string;
    subChannel?: string;
    payerDetail?: string;
}

export enum TradeType {
  WEB = 'WEB',
  APP = 'APP',
  WAP = 'WAP',
  MINI_PROGRAM = 'MINI_PROGRAM',
  PAYMENT_LINK = 'PAYMENT_LINK',
  OTHERS = 'OTHERS',
}

export interface WebhookData {
  merchantTradeNo: string;
  productType: string;
  productName: string;
  transactTime: number;
  tradeType: TradeType;
  totalFee: number;
  currency: string;
  transactionId?: string;
  openUserId?: string;
  passThroughInfo?: string;
  commission: number;
  paymentInfo?: PaymentInfo;
}

export enum BinanceBizType {
  PAY = 'PAY',
  PAY_REFUND = 'PAY_REFUND',
  MERCHANT_QR_CODE = 'MERCHANT_QR_CODE',
}

export enum BinancePayStatus {
  PAY_SUCCESS = 'PAY_SUCCESS',
  PAY_CLOSED = 'PAY_CLOSED',
  PAY_FAIL = 'PAY_FAIL',
  MERCHANT_QR_CODE_SCANED = 'MERCHANT_QR_CODE_SCANED',
}

export enum BinanceRefundStatus {
  REFUND_SUCCESS = 'REFUND_SUCCESS',
}

export interface BinancePayWebhookDto {
  bizType: BinanceBizType;
  data: string;
  bizIdStr: string;
  bizId: number;
  bizStatus: BinancePayStatus;
}

export enum BinancePayTerminalType {
  WEB = 'WEB',
  APP = 'APP',
  WAP = 'WAP',
  MINI_PROGRAM = 'MINI_PROGRAM',
  PAYMENT_LINK = 'PAYMENT_LINK',
  OTHERS = 'OTHERS',
}

export interface OrderData {
  env: {
    terminalType: BinancePayTerminalType;
  };
  qrCodeReferId?: string;
  merchantTradeNo: string;
  orderAmount: number;
  currency: string;
  description: string;
  goodsDetails: {
    goodsType: string;
    goodsCategory: string;
    referenceGoodsId: string;
    goodsName: string;
    goodsDetail: string;
  }[];
}

export interface ChannelPartnerOrderData extends OrderData {
  merchantId: string;
}

export interface SubMerchantOrderData extends OrderData {
  merchant: {
    subMerchantId: string;
  };
}

export enum ResponseStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface BinancePayResponse<T> {
  status: ResponseStatus;
  code: string;
  data?: T;
  errorMessage?: string;
}

export type OrderResponse = BinancePayResponse<{
  prepayId: string;
  terminalType: string;
  expireTime: number;
  qrcodeLink: string;
  qrContent: string;
  checkoutUrl: string;
  deeplink: string;
  universalUrl: string;
  totalFee: number;
  currency: string;
}>;

export type CertificateResponse = BinancePayResponse<
  {
    certPublic: string;
    certSerial: string;
  }[]
>;

export interface BinancePayHeaders {
  timestamp: string;
  nonce: string;
  signature: string;
  certSN: string;
}

export interface AddSubMerchantResponse {
  status: string;
  code: string;
  data: {
    subMerchantId: number;
  };
}

export enum GoodsType {
  TangibleGoods = '01',
  VirtualGoods = '02',
}

export enum GoodsCategory {
  ElectronicsComputers = '0000',
  BooksMusicMovies = '1000',
  HomeGardenTools = '2000',
  ClothesShoesBags = '3000',
  ToysKidsBaby = '4000',
  AutomotiveAccessories = '5000',
  GameRecharge = '6000',
  EntertainmentCollection = '7000',
  Jewelry = '8000',
  DomesticService = '9000',
  BeautyCare = 'A000',
  Pharmacy = 'B000',
  SportsOutdoors = 'C000',
  FoodGroceryHealthProducts = 'D000',
  PetSupplies = 'E000',
  IndustryScience = 'F000',
  Others = 'Z000',
}

export enum StoreType {
  ONLINE = 0,
  PHYSICAL = 1,
  ONLINE_AND_PHYSICAL = -1,
}

export enum MerchantMCC {
  AccommodationAndFoodServices = '1001',
  AdministrativeSupportWasteManagement = '1002',
  AgricultureForestryFishingHunting = '1004',
  ArtsEntertainmentRecreation = '1005',
  Construction = '1006',
  Broker = '1007',
  CryptoATM = '1008',
  CryptoMining = '1009',
  ProprietaryCryptoTraders = '1010',
  AlgorithmCryptoTraders = '1011',
  P2PMerchants = '1012',
  OtherDigitalAssetServicesProvider = '1013',
  Bank = '1014',
  NonBankFinancialInstitution = '1015',
  MoneyServicesBusinessPaymentServiceProviders = '1016',
  FamilyOffice = '1017',
  PersonalInvestmentCompanies = '1018',
  SuperannuationFund = '1019',
  SovereignWealthFund = '1020',
  InvestmentFunds = '1021',
  EducationalServices = '1022',
  Betting = '1024',
  HealthCareSocialAssistance = '1025',
  Information = '1026',
  GeneralWholesalers = '1027',
  ManagementOfCompaniesEnterprises = '1028',
  PreciousStonesPreciousMetalsDealers = '1029',
  CrudeOilNaturalGasDealers = '1030',
  GeneralManufacturing = '1031',
  Marijuana = '1032',
  MiningExtraction = '1033',
  PawnShops = '1034',
  ProfessionalServices = '1035',
  ScientificTechnicalServices = '1036',
  PublicAdministration = '1037',
  RealEstateRentalLeasing = '1038',
  RetailStoresElectronics = '1039',
  RetailStoresFB = '1040',
  RetailStoresJewelry = '1041',
  RetailTradeOthers = '1042',
  SaleOfDrugsPharmaceuticalProducts = '1043',
  Tobacco = '1044',
  TransportationWarehousing = '1045',
  Utilities = '1046',
  OtherCryptoWeb3Services = '1047',
  Other = '9999',
}

