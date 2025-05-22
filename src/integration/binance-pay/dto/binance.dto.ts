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