import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { BinancePayHeaders, BinancePayWebhookDto, CertificateResponse, OrderResponse } from '../dto/binance.dto';
import { IPaymentLinkProvider, OrderResult, WebhookResult } from '../share/IPaymentLinkProvider';
import { C2BPaymentStatus } from '../share/PaymentStatus';

@Injectable()
export class BinancePayService implements IPaymentLinkProvider<BinancePayWebhookDto> {
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

  async createOrder(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    quote: PaymentQuote,
  ): Promise<OrderResult> {
    const orderDetails: any = {
      env: {
        terminalType: 'OTHERS',
      },
      merchantTradeNo: quote.uniqueId.replace('plq_', ''),
      orderAmount: transferInfo.amount,
      currency: transferInfo.asset,
      description: payment.memo,
      goodsDetails: [
        {
          goodsType: '01',
          goodsCategory: 'D000',
          referenceGoodsId: '01',
          goodsName: payment.memo,
          goodsDetail: payment.memo,
        },
      ],
    };

    const { binancePayMerchantId, binancePaySubMerchantId } = payment.link.configObj;
    if (binancePayMerchantId) {
      orderDetails.merchantId = binancePayMerchantId;
    } else {
      orderDetails.merchant = {
        subMerchantId: binancePaySubMerchantId,
      };
    }

    try {
      const response = await this.http.post<OrderResponse>(
        `${this.baseUrl}/binancepay/openapi/v3/order`,
        orderDetails,
        {
          headers: this.getHeaders(orderDetails),
        },
      );

      const {
        data: { deeplink, qrcodeLink, prepayId },
      } = response;

      return {
        providerOrderId: prepayId,
        paymentRequest: qrcodeLink,
        metadata: response.data,
      };
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

  public async verifySignature(body: BinancePayWebhookDto, headers: BinancePayHeaders): Promise<boolean> {
    const { timestamp, nonce, signature, certSN } = headers;
    const webhookData = JSON.stringify({ ...body, bizId: body.bizIdStr }).replace(/"bizId":"(\d+)"/g, '"bizId":$1');
    const payload = `${timestamp}\n${nonce}\n${webhookData}\n`;

    const { data } = await this.queryCertificate();
    const cert = data.find((cert) => cert.certSerial === certSN);
    if (!cert) {
      throw new Error('Certificate not found');
    }

    const verify = crypto.createVerify('SHA256');
    verify.write(payload);
    verify.end();

    const decodedSignature = Buffer.from(signature, 'base64');
    return verify.verify(cert.certPublic, decodedSignature);
  }

  async handleWebhook(dto: BinancePayWebhookDto): Promise<WebhookResult> {
    const { bizIdStr } = dto;

    return {
      providerOrderId: bizIdStr,
      status: C2BPaymentStatus.COMPLETED,
      metadata: dto,
    };
  }
}
