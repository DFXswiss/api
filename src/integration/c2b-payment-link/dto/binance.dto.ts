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

export interface WebhookData {
    merchantTradeNo: string;
    productType: string;
    productName: string;
    transactTime: number;
    tradeType: 'WEB' | 'APP' | 'WAP' | 'MINI_PROGRAM' | 'PAYMENT_LINK' | 'OTHERS';
    totalFee: number;
    currency: string;
    transactionId?: string;
    openUserId?: string;
    passThroughInfo?: string;
    commission: number;
    paymentInfo?: PaymentInfo;
}

export enum BinancePayStatus {
    PAY_SUCCESS = 'PAY_SUCCESS',
    PAY_CLOSED = 'PAY_CLOSED',
    PAY_FAIL = 'PAY_FAIL'
}

export interface BinancePayWebhookDto {
    bizType: string;
    data: string;
    bizIdStr: string;
    bizId: number;
    bizStatus: BinancePayStatus;
}

export interface OrderData {
    env: {
        terminalType: string;
    };
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

export interface BinancePayResponse<T> {
    status: 'SUCCESS' | 'FAILED';
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