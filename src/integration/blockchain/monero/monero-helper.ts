import { Util } from 'src/shared/utils/util';
import { GetTransactionResultDto } from './dto/monero.dto';

export class MoneroHelper {
  // https://web.getmonero.org/resources/moneropedia/denominations.html
  // AU = Atomic Unit (piconero)
  private static AU_XMR_FACTOR = 10 ** 12;

  // --- CONVERT --- /
  static xmrToAu(xmrAmount: number): number {
    return Util.round(xmrAmount * MoneroHelper.AU_XMR_FACTOR, 12);
  }

  static auToXmr(auAmount: number): number {
    return Util.round(auAmount / MoneroHelper.AU_XMR_FACTOR, 12);
  }

  // --- UTILS --- /
  static isTransactionComplete(transaction: GetTransactionResultDto): boolean {
    return 'OK' === transaction.status && transaction.block_height && transaction.confirmations > 0;
  }
}
