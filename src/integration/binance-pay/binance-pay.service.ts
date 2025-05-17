import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';

interface OrderData {
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

export interface DirectMerchantOrderData extends OrderData {
  merchantId: string;
}

export interface ChannelPartnerOrderData extends OrderData {
  merchant: {
    subMerchantId: string;
  };
}

export interface OrderResponse {
  status: 'SUCCESS' | 'FAILED';
  code: string;
  data?: {
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
  };
  errorMessage?: string;
}

@Injectable()
export class BinancePayService {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://bpay.binanceapi.com';

  constructor(private http: HttpService) {
    this.apiKey = Config.payment.binancePayPublic;
    this.secretKey = Config.payment.binancePaySecret;
  }

  private generateSignature(timestamp: number, nonce: string, body: string): string {
    const data = `${timestamp}\n${nonce}\n${body}\n`;
    return crypto.createHmac('sha512', this.secretKey).update(data).digest('hex').toUpperCase();
  }

  private getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async createOrder(orderData: DirectMerchantOrderData | ChannelPartnerOrderData): Promise<OrderResponse> {
    const timestamp = Date.now();
    const nonce = this.getNonce();
    const body = JSON.stringify(orderData);
    const signature = this.generateSignature(timestamp, nonce, body);

    try {
      const response = await this.http.post<OrderResponse>(`${this.baseUrl}/binancepay/openapi/v3/order`, orderData, {
        headers: {
          'BinancePay-Timestamp': timestamp,
          'BinancePay-Nonce': nonce,
          'BinancePay-Certificate-SN': this.apiKey,
          'BinancePay-Signature': signature,
        },
      });
      return response;
    } catch (error) {
      throw error.response?.data || error;
    }
  }
}

const exampleOrder = {
  status: 'SUCCESS',
  code: '000000',
  data: {
    currency: 'USDT',
    totalFee: '25.17',
    prepayId: '363969700195475456',
    terminalType: 'APP',
    expireTime: 1747326999067,
    qrcodeLink: 'https://public.bnbstatic.com/static/payment/20250515/10d4263e-29b5-4cd5-a094-5a44b58fc94f.jpg',
    qrContent: 'https://app.binance.com/qr/dplk8d729cd0b5b646fa96dc4f951bcb488b',
    checkoutUrl: 'https://pay.binance.com/en/checkout/637e918899f14f128010b28372a167a1',
    deeplink: 'bnc://app.binance.com/payment/secpay?tempToken=Y227jEaCxWU0KFsWPd0URnKE7wg4dB4M',
    universalUrl:
      'https://app.binance.com/payment/secpay?linkToken=637e918899f14f128010b28372a167a1&_dp=Ym5jOi8vYXBwLmJpbmFuY2UuY29tL3BheW1lbnQvc2VjcGF5P3RlbXBUb2tlbj1ZMjI3akVhQ3hXVTBLRnNXUGQwVVJuS0U3d2c0ZEI0TQ',
  },
};
