export interface EP2Report {
  '?xml': {
    '@_version': '1.0';
    '@_encoding': 'UTF-8';
  };
  'ep2:message': {
    '@_xmlns:ep2': 'http://www.eftpos2000.ch';
    '@_specversion': '0740';

    'ep2:rafrsp': {
      '@_msgnum': '3795';

      'ep2:RAFHead': {
        'ep2:MctID': string;
        'ep2:PeEndDate': string;
        'ep2:RAFDate': string;
        'ep2:RAFTime': string;
      };
      'ep2:RAFDet': {
        'ep2:bdrecdet': Ep2Transaction[];
      };
    };
  };
}

export interface Ep2Transaction {
  'ep2:AcqPayDate': string;
  'ep2:AmtFee': number;
  'ep2:AmtFeeCurrC': string;
  'ep2:AmtSettlement': number;
  'ep2:AmtSettlementCurrC': string;
  'ep2:AID': string;
  'ep2:AuthC': string;
  'ep2:MctID': string;
  'ep2:TrmID': string;
  'ep2:TrxAmt': number;
  'ep2:TrxCurrC': string;
  'ep2:TrxDate': string;
  'ep2:TrxTime': string;
  'ep2:TrxOri': number;
  'ep2:TrxRefNum': string;
}
