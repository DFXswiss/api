import { createIntegratedAddress, splitIntegratedAddress } from '@zano-project/zano-utils-js';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { ZanoAddressDto } from './dto/zano.dto';

export class ZanoHelper {
  // AU = Atomic Unit (there is currently no official name for the smallest zano unit)
  static readonly ZANO_DECIMALS = 12;
  private static readonly AU_ZANO_FACTOR = 10 ** ZanoHelper.ZANO_DECIMALS;

  // --- CONVERT --- /

  static zanoToAu(xmrAmount?: number): number | undefined {
    return xmrAmount && Util.round(xmrAmount * ZanoHelper.AU_ZANO_FACTOR, 0);
  }

  static auToZano(auAmount?: number): number | undefined {
    return auAmount && Util.round(auAmount / ZanoHelper.AU_ZANO_FACTOR, ZanoHelper.ZANO_DECIMALS);
  }

  // --- DEPOSIT ADDRESS / PAYMENT ADDRESS --- //

  static createDepositAddress(accountIndex: number): string {
    return createIntegratedAddress(
      Config.blockchain.zano.wallet.address,
      ZanoHelper.mapIndexToPaymentIdHex(accountIndex),
    );
  }

  static createPaymentAddress(accountIndex: number): string {
    return createIntegratedAddress(Config.payment.zanoAddress, ZanoHelper.mapIndexToPaymentIdHex(accountIndex));
  }

  static splitIntegratedAddress(integratedAddress: string): ZanoAddressDto | undefined {
    if (/^iZ[a-zA-Z0-9]{106}$/.test(integratedAddress)) {
      const splittedAddress = splitIntegratedAddress(integratedAddress);

      return {
        address: splittedAddress.masterAddress,
        depositAddress: {
          address: integratedAddress,
          paymentId: splittedAddress.paymentId,
          accountIndex: ZanoHelper.mapPaymentIdHexToIndex(splittedAddress.paymentId),
        },
      };
    }
  }

  static mapIndexToPaymentIdHex(index: number): string {
    return index.toString(16).padStart(16, '0');
  }

  static mapPaymentIdHexToIndex(paymentIdHex: string): number | undefined {
    const paymentId = parseInt(paymentIdHex, 16);
    if (!isNaN(paymentId)) return paymentId;
  }
}
