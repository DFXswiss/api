import { createIntegratedAddress, splitIntegratedAddress } from '@zano-project/zano-utils-js';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { ZanoAddressDto } from './dto/zano.dto';

export class ZanoHelper {
  // AU = Atomic Unit (there is currently no official name for the smallest zano unit)
  static readonly ZANO_DECIMALS = 12;

  // --- CONVERT --- /
  static toAuAmount(amount?: number, decimals?: number): number | undefined {
    const useDecimals = decimals ?? ZanoHelper.ZANO_DECIMALS;
    const factor = 10 ** useDecimals;
    return amount && Util.roundByPrecision(amount * factor, 0);
  }

  static fromAuAmount(auAmount?: number, decimals?: number): number | undefined {
    const useDecimals = decimals ?? ZanoHelper.ZANO_DECIMALS;
    const factor = 10 ** useDecimals;
    return auAmount && Util.roundByPrecision(auAmount / factor, useDecimals);
  }

  // --- DEPOSIT ADDRESS / PAYMENT ADDRESS --- //

  static createDepositAddress(accountIndex: number): string {
    return createIntegratedAddress(
      Config.blockchain.zano.wallet.address,
      ZanoHelper.mapIndexToPaymentIdHex(accountIndex),
    );
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
