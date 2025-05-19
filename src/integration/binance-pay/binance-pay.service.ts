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

export type CertificateResponse = BinancePayResponse<{
  certPublic: string;
  certSerial: string;
}>;

interface PaymentInfo {
  payMethod: string;
  paymentInstructions: {
    currency: string;
    amount: number;
    price: number;
  }[];
  channel: string;
}

interface WebhookData {
  merchantTradeNo: string;
  productType: string;
  productName: string;
  transactTime: number;
  tradeType: string;
  totalFee: number;
  currency: string;
  transactionId: string;
  openUserId: string;
  commission: number;
  paymentInfo: PaymentInfo;
}

export interface BinancePayWebhookDto {
  bizType: string;
  data: string; // JSON string of WebhookData
  bizIdStr: string;
  bizId: number;
  bizStatus: string;
}

@Injectable()
export class BinancePayService {
  private readonly baseUrl = 'https://bpay.binanceapi.com';
  private readonly apiKey: string;
  private readonly secretKey: string;
  private certificatedExpiry: number;
  private certPublic: string;
  private certSerial: string;

  constructor(private http: HttpService) {
    this.apiKey = Config.payment.binancePayPublic;
    this.secretKey = Config.payment.binancePaySecret;
    this.certificatedExpiry = 0;
  }

  private generateSignature(timestamp: number, nonce: string, body: string): string {
    const data = `${timestamp}\n${nonce}\n${body}\n`;
    return crypto.createHmac('sha512', this.secretKey).update(data).digest('hex').toUpperCase();
  }

  private getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private getHeaders(body: any): Record<string, string | number> {
    const timestamp = Date.now();
    const nonce = this.getNonce();
    const signature = this.generateSignature(timestamp, nonce, JSON.stringify(body));

    return {
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': this.apiKey,
      'BinancePay-Signature': signature,
    };
  }

  async createOrder(orderData: DirectMerchantOrderData | ChannelPartnerOrderData): Promise<OrderResponse> {
    try {
      const response = await this.http.post<OrderResponse>(`${this.baseUrl}/binancepay/openapi/v3/order`, orderData, {
        headers: this.getHeaders(orderData),
      });
      return response;
    } catch (error) {
      throw error.response?.data || error;
    }
  }

  async queryCertificate(): Promise<CertificateResponse> {
    if (Date.now() < this.certificatedExpiry) {
      return {
        status: 'SUCCESS',
        code: '000000',
        data: {
          certPublic: this.certPublic,
          certSerial: this.certSerial,
        },
      };
    }

    this.certificatedExpiry = Date.now() + 5 * 60 * 1000;
    const response = await this.http.post<CertificateResponse>(
      `${this.baseUrl}/binancepay/openapi/certificates`,
      {},
      {
        headers: this.getHeaders({}),
      },
    );

    this.certPublic = response.data.certPublic;
    this.certSerial = response.data.certSerial;

    return response;
  }

  public async verifyWebhook(dto: BinancePayWebhookDto, headers: Record<string, string>): Promise<boolean> {
    const { 'BinancePay-Timestamp': timestamp, 'BinancePay-Nonce': nonce, 'BinancePay-Signature': signature } = headers;
    const payload = `${timestamp}\n${nonce}\n${dto.data}\n`;
    const decodedSignature = Buffer.from(signature, 'base64');
    const { data } = await this.queryCertificate();
    return crypto.verify('sha256', Buffer.from(payload), data?.certPublic, decodedSignature);
  }

  async handleWebhook(dto: BinancePayWebhookDto): Promise<void> {
    const webhookData: WebhookData = JSON.parse(dto.data);
    console.log(webhookData);
  }
}
