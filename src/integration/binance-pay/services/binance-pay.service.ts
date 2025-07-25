import { BadRequestException, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { C2BPaymentStatus } from 'src/subdomains/core/payment-link/enums';
import {
  C2BOrderResult,
  C2BPaymentLinkProvider,
  C2BWebhookResult,
} from '../../../subdomains/core/payment-link/share/c2b-payment-link.provider';
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
  OrderData,
  OrderResponse,
  ResponseStatus,
  StoreType,
  SubMerchantOrderData,
} from '../dto/binance.dto';

@Injectable()
export class BinancePayService implements C2BPaymentLinkProvider<BinancePayWebhookDto>, OnModuleInit {
  private readonly logger = new DfxLogger(BinancePayService);

  private readonly baseUrl = 'https://bpay.binanceapi.com';
  private readonly apiKey: string;
  private readonly secretKey: string;
  private certificatedExpiry: number;
  private cert: CertificateResponse['data'];

  private static readonly HOURS_2 = 2 * 60 * 60 * 1000;

  private readonly SUPPORTED_BIZ_TYPES = [
    BinanceBizType.PAY,
    BinanceBizType.PAY_REFUND,
    BinanceBizType.MERCHANT_QR_CODE,
  ];

  constructor(private readonly http: HttpService) {
    this.apiKey = Config.payment.binancePayPublic;
    this.secretKey = Config.payment.binancePaySecret;
    this.certificatedExpiry = 0;
  }

  private generateSignature(timestamp: number, nonce: string, body: string): string {
    if (!this.secretKey) throw new ServiceUnavailableException('Binance Pay service is not configured');
    const data = `${timestamp}\n${nonce}\n${body}\n`;
    return crypto.createHmac('sha512', this.secretKey).update(data).digest('hex').toUpperCase();
  }

  private getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private getHeaders(body: any): Record<string, string | number> {
    if (!this.apiKey) throw new ServiceUnavailableException('Binance Pay service is not configured');

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

  public isPaymentLinkEnrolled(paymentLink: PaymentLink): boolean {
    // Method 1: check local payment link config
    try {
      const config = paymentLink.linkConfigObj;
      if (config.binancePayMerchantId || config.binancePaySubMerchantId) {
        return true;
      }
    } catch (e) {}

    // Method 2: check configObj if available
    try {
      const config = paymentLink.configObj;
      if (config.binancePayMerchantId || config.binancePaySubMerchantId) {
        return true;
      }
    } catch (e) {}

    // No keys are available
    return false;
  }

  private validateEnrollmentRequiredFieldsOrThrow(paymentLink: PaymentLink): void {
    const recipient = paymentLink.recipient;

    const missing = [
      'externalId',
      'label',
      'name',
      'merchantMcc',
      'country',
      'website',
      'street',
      'houseNumber',
      'zip',
      'city',
      'registrationNumber',
    ].filter((f) => !(paymentLink[f] ?? recipient[f] ?? recipient.address?.[f]));

    if (missing.length) {
      throw new BadRequestException(`Missing required fields for Binance Pay: ${missing.join(', ')}`);
    }
  }

  public async enrollPaymentLink(paymentLink: PaymentLink): Promise<Record<string, string>> {
    this.validateEnrollmentRequiredFieldsOrThrow(paymentLink);

    const recipient = paymentLink.recipient;

    const subMerchantData = {
      merchantName: `${paymentLink.name} - ${paymentLink.label} - ${paymentLink.externalId}`,
      storeType: paymentLink.storeType || StoreType.PHYSICAL,
      merchantMcc: paymentLink.merchantMcc,
      country: recipient.address?.country,
      siteUrl: recipient.website,
      address: `${recipient.address?.street} ${recipient.address?.houseNumber}, ${recipient.address?.zip} ${recipient.address?.city}`,
      registrationNumber: paymentLink.registrationNumber,
      registrationCountry: recipient.address?.country,
      registrationAddress: `${recipient.address?.street} ${recipient.address?.houseNumber}, ${recipient.address?.zip} ${recipient.address?.city}`,
    };

    try {
      const response = await this.http.post<AddSubMerchantResponse>(
        `${this.baseUrl}/binancepay/openapi/submerchant/add`,
        subMerchantData,
        {
          headers: this.getHeaders(subMerchantData),
        },
      );
      return { binancePaySubMerchantId: response.data.subMerchantId.toString() };
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to enroll payment link: ${error.response?.data?.errorMessage || JSON.stringify(error)}`,
      );
    }
  }

  async createOrder(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    quote: PaymentQuote,
  ): Promise<C2BOrderResult> {
    const orderDetails: OrderData = {
      env: {
        terminalType: BinancePayTerminalType.OTHERS,
      },
      qrCodeReferId: transferInfo.referId,
      merchantTradeNo: quote.uniqueId.replace('plq_', ''),
      orderAmount: transferInfo.amount,
      currency: transferInfo.asset,
      description: payment.memo,
      orderExpireTime: quote.expiryDate.getTime(),
      goodsDetails: [
        {
          goodsType: payment.link.goodsType || GoodsType.TangibleGoods, // TODO: Remove default values
          goodsCategory: payment.link.goodsCategory || GoodsCategory.FoodGroceryHealthProducts,
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
      throw new ServiceUnavailableException(
        `Failed to create order: ${error.response?.data?.errorMessage || JSON.stringify(error)}`,
      );
    }
  }

  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.BINANCE_PAY_CERTIFICATES_UPDATE })
  async updateCertificates(): Promise<void> {
    try {
      const headers = this.getHeaders({});
      const response = await this.http.post<CertificateResponse>(
        `${this.baseUrl}/binancepay/openapi/certificates`,
        {},
        { headers },
      );

      this.cert = response.data;
      this.certificatedExpiry = Date.now() + BinancePayService.HOURS_2;
    } catch (e) {
      if (!e.message?.includes('not configured')) this.logger.error(`Failed to update certificates:`, e);
    }
  }

  onModuleInit() {
    void this.updateCertificates();
  }

  async getCertificates(): Promise<CertificateResponse> {
    if (!this.cert || this.certificatedExpiry < Date.now()) {
      await this.updateCertificates();
    }

    if (!this.cert) {
      throw new ServiceUnavailableException('Binance Pay certificate not found');
    }

    return {
      status: ResponseStatus.SUCCESS,
      code: '000000',
      data: this.cert,
    };
  }

  public async verifySignature(body: BinancePayWebhookDto, headers: BinancePayHeaders): Promise<boolean> {
    const { timestamp, nonce, signature, certSN } = headers;
    const webhookData = JSON.stringify({ ...body, bizId: body.bizIdStr }).replace(/"bizId":"(\d+)"/g, '"bizId":$1');
    const payload = `${timestamp}\n${nonce}\n${webhookData}\n`;

    const { data } = await this.getCertificates();
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
      case BinancePayStatus.MERCHANT_QR_CODE_SCANED:
        return C2BPaymentStatus.WAITING;
    }
  }

  private isSupportedBizType(bizType: string): boolean {
    return this.SUPPORTED_BIZ_TYPES.includes(bizType as BinanceBizType);
  }

  async handleWebhook(dto: BinancePayWebhookDto): Promise<C2BWebhookResult | undefined> {
    const { bizType, bizIdStr, bizStatus } = dto;
    if (!this.isSupportedBizType(bizType) || !this.getStatus(bizStatus)) return;

    return {
      providerOrderId: bizIdStr,
      status: this.getStatus(bizStatus),
      metadata: JSON.parse(dto.data),
    };
  }
}
