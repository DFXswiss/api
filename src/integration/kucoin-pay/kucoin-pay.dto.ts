export enum SignatureVariant {
  CREATE_ORDER = 'CREATE_ORDER',
  ORDER_NOTIFICATION = 'ORDER_NOTIFICATION',
  REFUND_NOTIFICATION = 'REFUND_NOTIFICATION',
}

export interface KucoinPayOrderData {
  requestId: string;
  payOrderId: string;
  expireTime: number;
  qrcode: string;
  appPayUrl: string;
  qrcodeUrl: string;
}

export interface KucoinPayOrderResponse {
  success: boolean;
  code: string;
  msg: string;
  retry: boolean;
  data: KucoinPayOrderData;
}

export enum KucoinOrderType {
  ORDER = 'ORDER',
  REFUND = 'REFUND',
  TRADE = 'TRADE',
}

export interface KucoinWebhookNotification {
  orderType: KucoinOrderType;
  requestId: string;
  subMerchantId: string;
  merchantId: string;
  payerUserId?: string;
  retrieveKycStatus?: boolean;
  payerDetail?: string;
}

export enum KucoinOrderNotificationStatus {
  SUCCEEDED = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  PROCESSING = 'PROCESSING',
  USER_PAY_COMPLETED = 'USER_PAY_COMPLETED',
}

export interface KucoinPayOrderNotification extends KucoinWebhookNotification {
  payOrderId: string;
  status: KucoinOrderNotificationStatus;
  orderCurrency: string;
  orderAmount: number;
  goods: {
    goodsId: string;
    goodsName: string;
    goodsDesc: string;
  };
  reference: string;
  payTime: number;
  canRefundAmount: number;
  refundCurrency: string;
  errorReason?: string;
}

export enum KucoinRefundNotificationStatus {
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  REFUND_PART = 'REFUND_PART',
  REFUND_FULL = 'REFUND_FULL',
}

export interface KucoinPayRefundNotification extends KucoinWebhookNotification {
  refundId: string;
  payId: string;
  refundAmount: string;
  remainingRefundAmount: string;
  status: KucoinRefundNotificationStatus;
  refundFinishTime: number;
  refundCurrency: string;
  remainingRefundCurrency: string;
  reference: string;
  refundReason: string;
}
