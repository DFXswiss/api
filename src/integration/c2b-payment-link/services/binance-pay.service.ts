import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import {
  AddSubMerchantResponse,
  BinanceBizType,
  BinancePayHeaders,
  BinancePayStatus,
  BinancePayTerminalType,
  BinancePayWebhookDto,
  BinanceRefundStatus,
  CertificateResponse,
  ChannelPartnerOrderData,
  GoodsCategory,
  GoodsType,
  MerchantMCC,
  OrderData,
  OrderResponse,
  ResponseStatus,
  StoreType,
  SubMerchantOrderData,
} from '../dto/binance.dto';
import { IPaymentLinkProvider, OrderResult, WebhookResult } from '../share/IPaymentLinkProvider';
import { C2BPaymentStatus } from '../share/PaymentStatus';

@Injectable()
export class BinancePayService implements IPaymentLinkProvider<BinancePayWebhookDto> {
  private readonly logger = new DfxLogger(BinancePayService);

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

  public isAvailable(paymentLink: PaymentLinkPayment): boolean {
    return Boolean(
      paymentLink.link.configObj.binancePayMerchantId || paymentLink.link.configObj.binancePaySubMerchantId,
    );
  }

  public async enrollPaymentLink(paymentLink: PaymentLink): Promise<Record<string, string>> {
    const subMerchantData = {
      merchantName: paymentLink.name,
      storeType: StoreType.PHYSICAL,
      merchantMcc: MerchantMCC.RetailTradeOthers,
      country: paymentLink.country?.symbol,
      siteUrl: paymentLink.website,
      address: `${paymentLink.street} ${paymentLink.houseNumber}, ${paymentLink.zip} ${paymentLink.city}`,
      registrationNumber: paymentLink.registrationNumber,
      registrationCountry: paymentLink.country?.symbol,
      registrationAddress: `${paymentLink.street} ${paymentLink.houseNumber}, ${paymentLink.zip} ${paymentLink.city}`,
    };

    try {
      const response = await this.http.post<AddSubMerchantResponse>(
        `${this.baseUrl}/binancepay/openapi/submerchant/add`,
        subMerchantData,
        { headers: this.getHeaders(subMerchantData) },
      );

      return { binancePaySubMerchantId: response.data.subMerchantId.toString() };
    } catch (e) {
      this.logger.info('Failed to enroll payment link for Binance Pay:', e);
      throw new ServiceUnavailableException(`Failed to enroll payment link: ${e.message}`);
    }
  }

  async createOrder(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    quote: PaymentQuote,
  ): Promise<OrderResult> {
    const orderDetails: OrderData = {
      env: {
        terminalType: BinancePayTerminalType.OTHERS,
      },
      merchantTradeNo: quote.uniqueId.replace('plq_', ''),
      orderAmount: transferInfo.amount,
      currency: transferInfo.asset,
      description: payment.memo,
      goodsDetails: [
        {
          goodsType: GoodsType.TangibleGoods,
          goodsCategory: GoodsCategory.FoodGroceryHealthProducts,
          referenceGoodsId: '01',
          goodsName: payment.memo,
          goodsDetail: payment.memo,
        },
      ],
    };

    const { binancePayMerchantId, binancePaySubMerchantId } = payment.link.configObj;
    if (binancePayMerchantId) {
      (orderDetails as ChannelPartnerOrderData).merchantId = binancePayMerchantId;
    } else {
      (orderDetails as SubMerchantOrderData).merchant = {
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
        status: ResponseStatus.SUCCESS,
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
    const webhookData = JSON.stringify({ ...body, bizId: +body.bizIdStr });
    const payload = `${timestamp}\n${nonce}\n${webhookData}\n`;

    const { data } = await this.queryCertificate();
    const cert = data.find((cert) => cert.certSerial === certSN);
    if (!cert) throw new Error('Certificate not found');

    const decodedSignature = Buffer.from(signature, 'base64').toString('base64');
    return Util.verifySign(payload, cert.certPublic, decodedSignature, 'sha256', 'base64');
  }

  private getStatus(status: string): C2BPaymentStatus {
    switch (status) {
      case BinancePayStatus.PAY_SUCCESS:
        return C2BPaymentStatus.COMPLETED;
      case BinanceRefundStatus.REFUND_SUCCESS:
        return C2BPaymentStatus.REFUNDED;
      case BinancePayStatus.PAY_CLOSED:
        return C2BPaymentStatus.FAILED;
    }
  }

  private isSupportedBizType(bizType: string): boolean {
    return bizType === BinanceBizType.PAY || bizType === BinanceBizType.PAY_REFUND;
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
