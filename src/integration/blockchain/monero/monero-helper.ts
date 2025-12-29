import { Util } from 'src/shared/utils/util';
import { MoneroTransactionDto } from './dto/monero.dto';

export class MoneroHelper {
  // https://web.getmonero.org/resources/moneropedia/denominations.html
  // AU = Atomic Unit (piconero)
  private static readonly AU_XMR_FACTOR = 10 ** 12;

  // --- CONVERT --- /
  static xmrToAu(xmrAmount?: number): number | undefined {
    return xmrAmount && Util.round(xmrAmount * MoneroHelper.AU_XMR_FACTOR, 0);
  }

  static auToXmr(auAmount?: number): number | undefined {
    return auAmount && Util.round(auAmount / MoneroHelper.AU_XMR_FACTOR, 12);
  }

  // --- UTILS --- /
  static isTransactionComplete(transaction: MoneroTransactionDto, confirmations = 0): boolean {
    return transaction.block_height && transaction.confirmations > confirmations;
  }
}
