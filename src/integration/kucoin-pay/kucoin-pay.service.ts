import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
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
} from 'src/subdomains/core/payment-link/share/c2b-payment-link.provider';
import {
  KucoinOrderNotificationStatus,
  KucoinOrderType,
  KucoinPayOrderNotification,
  KucoinPayOrderResponse,
  KucoinPayRefundNotification,
  SignatureVariant,
} from './kucoin-pay.dto';

@Injectable()
export class KucoinPayService
  implements C2BPaymentLinkProvider<KucoinPayOrderNotification | KucoinPayRefundNotification>
{
  private readonly logger = new DfxLogger(KucoinPayService);
  private readonly baseUrl = 'https://pay.tunas.io/api/kucoinpay';
  private readonly apiKey: string;
  private readonly verificationKey: string;
  private readonly privateKey: crypto.KeyObject;

  constructor(private readonly http: HttpService) {
    this.apiKey = Config.payment.kucoinPayApiKey;

    const secretKey =
      Config.payment.kucoinPaySigningKey
        ?.replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\n/g, '') ?? '';

    this.privateKey = crypto.createPrivateKey({
      key: Buffer.from(secretKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });

    this.verificationKey = Config.payment.kucoinPayPublicKey;
  }

  async createOrder(
    payment: PaymentLinkPayment,
    transferInfo: TransferInfo,
    quote: PaymentQuote,
  ): Promise<C2BOrderResult> {
    const timestamp = Date.now();
    const subMerchantId =
      payment.link.linkConfigObj.kucoinPaySubMerchantId ?? payment.link.configObj.kucoinPaySubMerchantId;
    const orderDetails = {
      requestId: quote.uniqueId,
      expireTime: quote.expiryDate.getTime() - timestamp,
      goods: [
        {
          goodsId: '0001',
          goodsDesc: payment.memo,
          goodsName: payment.memo,
        },
      ],
      orderAmount: transferInfo.amount,
      orderCurrency: transferInfo.asset,
      returnUrl: 'https://www.kucoinpay.com/order/succ',
      cancelUrl: 'https://www.kucoinpay.com/order/failed',
      subMerchantId,
      timestamp,
    };

    const signature = this.getSignature(SignatureVariant.CREATE_ORDER, orderDetails);

    const response = await this.http.post<KucoinPayOrderResponse>(this.baseUrl + '/api/v1/order/create', orderDetails, {
      headers: {
        'Content-Type': 'application/json',
        'PAY-API-VERSION': '3.8.1',
        'PAY-API-SIGN': signature,
        'PAY-API-KEY': this.apiKey,
        'PAY-API-TIMESTAMP': orderDetails.timestamp,
      },
    });

    if (!response.success) {
      this.logger.error(`Kucoin order has not been created: ${response.code} - ${response.msg}`);
      throw new ServiceUnavailableException('Kucoin order has not been created');
    }

    return {
      providerOrderId: response.data.payOrderId,
      paymentRequest: response.data.appPayUrl,
      metadata: response.data,
    };
  }

  isPaymentLinkEnrolled(paymentLink: PaymentLink): boolean {
    // Method 1: check local payment link config
    try {
      const config = paymentLink.linkConfigObj;
      if (config.kucoinPaySubMerchantId) return true;
    } catch (e) {}

    // Method 2: check configObj if available
    try {
      const config = paymentLink.configObj;
      if (config.kucoinPaySubMerchantId) return true;
    } catch (e) {}

    // No keys are available
    return false;
  }

  async verifySignature(
    body: KucoinPayRefundNotification | KucoinPayOrderNotification,
    headers: any,
  ): Promise<boolean> {
    const { 'pay-api-sign': signature, 'pay-api-timestamp': timestamp } = headers;
    if (!signature || !timestamp) return false;

    const variant = this.mapOrderTypeToSignatureVariant(body.orderType);
    const content = this.getSignatureContent(variant, { ...body, timestamp });

    return Util.verifySign(content, this.verificationKey, signature, 'sha256', 'base64');
  }

  async handleWebhook(
    dto: KucoinPayOrderNotification | KucoinPayRefundNotification,
  ): Promise<C2BWebhookResult | undefined> {
    if (![KucoinOrderType.ORDER, KucoinOrderType.TRADE, KucoinOrderType.REFUND].includes(dto.orderType)) return;

    switch (dto.status) {
      case KucoinOrderNotificationStatus.USER_PAY_COMPLETED:
      case KucoinOrderNotificationStatus.SUCCEEDED:
        return {
          providerOrderId: dto.payOrderId,
          status: C2BPaymentStatus.COMPLETED,
          metadata: dto,
        };

      case KucoinOrderNotificationStatus.CANCELLED:
      case KucoinOrderNotificationStatus.FAILED:
        return {
          providerOrderId: dto.payOrderId,
          status: C2BPaymentStatus.FAILED,
          metadata: dto,
        };
    }
  }

  enrollPaymentLink(): Promise<Record<string, string>> {
    return Promise.resolve({ kucoinPaySubMerchantId: Util.randomString(8) });
  }

  private mapOrderTypeToSignatureVariant(orderType: KucoinOrderType): SignatureVariant {
    switch (orderType) {
      case KucoinOrderType.TRADE:
      case KucoinOrderType.ORDER:
        return SignatureVariant.ORDER_NOTIFICATION;

      case KucoinOrderType.REFUND:
        return SignatureVariant.REFUND_NOTIFICATION;

      default:
        throw new BadRequestException(`Invalid order type ${orderType}`);
    }
  }

  private getSignature(variant: SignatureVariant, args: Record<string, any>): string {
    const content = this.getSignatureContent(variant, args);

    const signature = crypto.sign('RSA-SHA256', Buffer.from(content, 'utf8'), {
      key: this.privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    });

    return signature.toString('base64');
  }

  private getSignatureContent(variant: SignatureVariant, args: Record<string, any>): string {
    const paramOrder = this.getParamOrder(variant);

    return paramOrder
      .filter((param) => (param === 'apiKey' ? true : args[param] != null))
      .map((param) => (param === 'apiKey' ? `${param}=${this.apiKey}` : `${param}=${args[param]}`))
      .join('&');
  }

  private getParamOrder(variant: SignatureVariant): string[] {
    switch (variant) {
      case SignatureVariant.CREATE_ORDER:
        return [
          'apiKey',
          'expireTime',
          'orderAmount',
          'orderCurrency',
          'reference',
          'requestId',
          'source',
          'subMerchantId',
          'timestamp',
        ];

      case SignatureVariant.ORDER_NOTIFICATION:
        return [
          'apiKey',
          'errorReason',
          'orderAmount',
          'orderCurrency',
          'payOrderId',
          'payTime',
          'reference',
          'refundCurrency',
          'requestId',
          'status',
          'subMerchantId',
          'timestamp',
        ];

      case SignatureVariant.REFUND_NOTIFICATION:
        return [
          'apiKey',
          'merchantId',
          'payID',
          'refundAmount',
          'refundCurrency',
          'refundFinishTime',
          'refundId',
          'remainingRefundAmount',
          'remainingRefundCurrency',
          'requestId',
          'status',
          'subMerchantId',
          'timestamp',
        ];

      default:
        throw new BadRequestException(`Invalid variant ${variant}`);
    }
  }
}
