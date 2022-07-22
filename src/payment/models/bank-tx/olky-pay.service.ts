import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';

export interface Transaction {
  idCtp: number;
  dateEcriture: number[];
  dateValeur: number[];
  codeInterbancaireInterne: TransactionType;
  codeInterbancaire: string;
  credit: number;
  debit: number;
  line1: string;
  line2: string;
  instructingIban: string;
}

enum TransactionType {
  RECEIVED = 'SCT_RECEIVED',
  SENT = 'SCT_SENT',
  BILLING = 'BILLING',
}

@Injectable()
export class OlkyPayService {
  private readonly baseUrl = 'https://ws.olkypay.com/reporting/';
  private readonly loginUrl = 'https://ws.olkypay.com/reporting/ecritures/';

  constructor(private readonly http: HttpService) {}

  async getAllTransaction(fromDate: Date, toDate: Date): Promise<Transaction> {
    const url = `${this.baseUrl}/ecritures/${Config.bank.olkyPay.client}/${fromDate}/${toDate}`;

    try {
      const result = await this.http.post<Transaction>(url, Config.sepaTools,);

      return result;
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get Transactions from :`, error);
    }
  }
}
