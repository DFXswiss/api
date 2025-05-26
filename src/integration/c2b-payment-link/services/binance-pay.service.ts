import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { BinancePayHeaders, BinancePayWebhookDto, CertificateResponse, OrderResponse } from '../dto/binance.dto';
import { IPaymentLinkProvider, OrderData, WebhookResult } from '../share/IPaymentLinkProvider';
import { C2BPaymentStatus } from '../share/PaymentStatus';

@Injectable()
export class BinancePayService implements IPaymentLinkProvider<BinancePayWebhookDto> {
  private readonly baseUrl = 'https://bpay.binanceapi.com';
  private readonly apiKey: string;
  private readonly secretKey: string;
  private certificatedExpiry: number;
  private cert: CertificateResponse['data'];

  constructor(private readonly http: HttpService) {
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

  async createOrder(payment: PaymentLinkPayment, transferInfo: TransferInfo, quote: PaymentQuote): Promise<OrderData> {
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
        data: { deeplink, prepayId },
      } = response;

      return {
        providerOrderId: prepayId,
        paymentRequest: deeplink,
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
    if (!cert) throw new Error('Certificate not found');

    const decodedSignature = Buffer.from(signature, 'base64').toString('base64');
    return Util.verifySign(payload, cert.certPublic, decodedSignature, 'sha256', 'base64');
  }

  private getStatus(status: string): C2BPaymentStatus {
    switch (status) {
      case 'PAY_SUCCESS':
        return C2BPaymentStatus.COMPLETED;
      case 'REFUND_SUCCESS':
        return C2BPaymentStatus.REFUNDED;
      case 'PAY_CLOSED':
        return C2BPaymentStatus.FAILED;
    }
  }

  private isSupportedBizType(bizType: string): boolean {
    return bizType === 'PAY' || bizType === 'PAY_REFUND';
  }

  async handleWebhook(dto: BinancePayWebhookDto): Promise<WebhookResult | undefined> {
    const { bizType, bizIdStr, bizStatus } = dto;
    if (!this.isSupportedBizType(bizType) || !this.getStatus(bizStatus)) return;

    return {
      providerOrderId: bizIdStr,
      status: this.getStatus(bizStatus),
      metadata: dto,
    };
  }
}
