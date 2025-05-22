import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BinancePayWebhookDto } from './dto/binance.dto';

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

export type CertificateResponse = BinancePayResponse<
  {
    certPublic: string;
    certSerial: string;
  }[]
>;

@Injectable()
export class BinancePayService {
  private readonly baseUrl = 'https://bpay.binanceapi.com';
  private readonly apiKey: string;
  private readonly secretKey: string;
  private certificatedExpiry: number;
  private cert: CertificateResponse['data'];

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
    if (this.certificatedExpiry > Date.now()) {
      return {
        status: 'SUCCESS',
        code: '000000',
        data: this.cert,
      };
    }

    this.certificatedExpiry = Date.now() + 5 * 60 * 1000;
    const headers = this.getHeaders({});
    const response = await this.http.post<CertificateResponse>(
      `${this.baseUrl}/binancepay/openapi/certificates`,
      {},
      { headers },
    );

    this.cert = response.data;
    return response;
  }

  public async verifyWebhook(body: BinancePayWebhookDto, headers: Record<string, string>): Promise<boolean> {
    const {
      'binancepay-timestamp': timestamp,
      'binancepay-nonce': nonce,
      'binancepay-signature': signature,
      'binancepay-certificate-sn': certSN,
    } = headers;

    const webhookData = JSON.stringify({ ...body, bizId: body.bizIdStr }).replace(/"bizId":"(\d+)"/g, '"bizId":$1');
    const payload = `${timestamp}\n${nonce}\n${webhookData}\n`;

    const { data } = await this.queryCertificate();
    const cert = data.find((cert) => cert.certSerial === certSN);
    if (!cert) {
      throw new Error('Certificate not found');
    }

    const verify = crypto.createVerify("SHA256");
    verify.write(payload);
    verify.end();

    const decodedSignature = Buffer.from(signature, 'base64');
    return verify.verify(cert.certPublic, decodedSignature);
  }

  async handleWebhook(dto: BinancePayWebhookDto): Promise<void> {
    const webhookData = JSON.parse(dto.data);
    console.log(webhookData);
  }
}


/**
 {
  bizType: 'PAY_REFUND',
  data: '{"merchantTradeNo":"ff48beb8a22840c1","productType":"01","productName":"Kermit Frog - USD 2","transactTime":1747920833943,"tradeType":"OTHERS","totalFee":2.02020202,"currency":"USDT","openUserId":"00152a4d4e1be4f087735b3ae6e114c1","refundInfo":{"refundId":365252679965024256,"prepayId":"365250949097021440","orderAmount":"2.02020202","refundedAmount":"2.02020202","refundAmount":"2.02020202","remainingAttempts":9,"payerOpenId":"d1db54025d2c429c51d4c722b4cdd366","duplicateRequest":"N","refundStatus":"REFUNDED","refundCommission":"0.00000000","refundedCommission":"0.00000000"}}',
  bizIdStr: '365250949097021440',
  bizId: 365250949097021440,
  bizStatus: 'REFUND_SUCCESS'
}
*/