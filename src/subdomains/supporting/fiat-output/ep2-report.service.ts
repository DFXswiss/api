import { Injectable } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';
import { Util } from 'src/shared/utils/util';
import { EP2Report, Ep2Transaction } from './dto/ep2-report.dto';
import { FiatOutput } from './fiat-output.entity';

@Injectable()
export class Ep2ReportService {
  generateReport(entity: FiatOutput): string {
    const report: EP2Report = {
      '?xml': {
        '@_version': '1.0',
        '@_encoding': 'UTF-8',
      },
      'ep2:message': {
        '@_xmlns:ep2': 'http://www.eftpos2000.ch',
        '@_specversion': '0740',

        'ep2:rafrsp': {
          '@_msgnum': '3795',

          'ep2:RAFHead': {
            'ep2:MctID': `${entity.buyFiats[0].userData.id}`,
            'ep2:PeEndDate': this.ep2Date(entity.created),
            'ep2:RAFDate': this.ep2Date(entity.created),
            'ep2:RAFTime': this.ep2Time(entity.created),
          },
          'ep2:RAFDet': {
            'ep2:bdrecdet': entity.buyFiats.map((bf) => {
              const tx: Ep2Transaction = {
                'ep2:AcqPayDate': this.ep2Date(bf.outputDate),
                'ep2:AmtFee': this.ep2Amount(bf.totalFeeAmountChf),
                'ep2:AmtFeeCurrC': 'CHF',
                'ep2:AmtSettlement': this.ep2Amount(bf.amountInChf),
                'ep2:AmtSettlementCurrC': 'CHF',
                'ep2:AID': 'Crypto',
                'ep2:AuthC': bf.cryptoInput.paymentLinkPayment.externalId,
                'ep2:MctID': `${bf.userData.id}`,
                'ep2:TrmID': bf.cryptoInput.paymentLinkPayment.link.externalId,
                'ep2:TrxAmt': this.ep2Amount(bf.amountInChf),
                'ep2:TrxCurrC': 'CHF',
                'ep2:TrxDate': this.ep2Date(bf.cryptoInput.created),
                'ep2:TrxTime': this.ep2Time(bf.cryptoInput.created),
                'ep2:TrxOri': 0,
                'ep2:TrxRefNum': bf.cryptoInput.paymentLinkPayment.externalId,
              };

              return tx;
            }),
          },
        },
      },
    };

    return new XMLBuilder({ ignoreAttributes: false, format: true }).build(report);
  }

  private ep2Date(date: Date): string {
    return Util.isoDate(date).replace(/-/g, '');
  }

  private ep2Time(date: Date): string {
    return Util.isoTime(date).replace(/-/g, '');
  }

  private ep2Amount(amount: number): number {
    return Math.round(amount * 100);
  }
}
