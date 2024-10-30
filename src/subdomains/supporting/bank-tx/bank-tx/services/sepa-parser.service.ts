import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { SepaEntry } from '../dto/sepa-entry.dto';
import { SepaFile } from '../dto/sepa-file.dto';
import { ChargeRecord, SepaAddress, SepaCdi } from '../dto/sepa.dto';
import { BankTxBatch } from '../entities/bank-tx-batch.entity';
import { BankTx } from '../entities/bank-tx.entity';

@Injectable()
export class SepaParser implements OnModuleInit {
  private readonly logger = new DfxLogger(SepaParser);

  private chf: Fiat;

  constructor(private readonly pricingService: PricingService, private readonly fiatService: FiatService) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
  }

  parseSepaFile(xmlFile: string): SepaFile {
    return Util.parseXml<{ Document: SepaFile }>(xmlFile).Document;
  }

  parseBatch(file: SepaFile): Partial<BankTxBatch> {
    const info = file.BkToCstmrStmt.Stmt;
    const identification = info.Id;

    // try to parse the data
    let data: Partial<BankTxBatch> = {};
    try {
      data = {
        sequenceNumber: +info?.ElctrncSeqNb,
        creationDate: new Date(info?.CreDtTm),
        fromDate: new Date(info?.FrToDt?.FrDtTm),
        toDate: new Date(info?.FrToDt?.ToDtTm),
        duplicate: this.toString(info?.CpyDplctInd),
        iban: this.toString(info?.Acct?.Id?.IBAN),
        balanceBeforeAmount: +info?.Bal?.[0]?.Amt?.['#text'],
        balanceBeforeCurrency: this.toString(info?.Bal?.[0]?.Amt?.['@_Ccy']),
        balanceBeforeCdi: this.toString(info?.Bal?.[0]?.CdtDbtInd),
        balanceAfterAmount: +info?.Bal?.[1]?.Amt?.['#text'],
        balanceAfterCurrency: this.toString(info?.Bal?.[1]?.Amt?.['@_Ccy']),
        balanceAfterCdi: this.toString(info?.Bal?.[1]?.CdtDbtInd),
        totalCount: +info?.TxsSummry?.TtlNtries?.NbOfNtries,
        totalAmount: +info?.TxsSummry?.TtlNtries?.TtlNetNtry?.Amt,
        totalCdi: this.toString(info?.TxsSummry?.TtlNtries?.TtlNetNtry?.CdtDbtInd),
        creditCount: +info?.TxsSummry?.TtlCdtNtries?.NbOfNtries,
        creditAmount: +info?.TxsSummry?.TtlCdtNtries?.Sum,
        debitCount: +info?.TxsSummry?.TtlDbtNtries?.NbOfNtries,
        debitAmount: +info?.TxsSummry?.TtlDbtNtries?.Sum,
      };
    } catch (e) {
      this.logger.error(`Failed to import SEPA batch data for ID ${identification}:`, e);
    }

    return {
      identification: this.toString(identification),
      ...data,
    };
  }

  async parseEntries(file: SepaFile, accountIban: string): Promise<Partial<BankTx>[]> {
    const entries = Array.isArray(file.BkToCstmrStmt.Stmt.Ntry)
      ? file.BkToCstmrStmt.Stmt.Ntry
      : [file.BkToCstmrStmt.Stmt.Ntry];

    return Util.asyncMap(entries, async (entry) => {
      const accountServiceRef =
        entry?.NtryDtls?.TxDtls?.Refs?.AcctSvcrRef ??
        `CUSTOM/${file.BkToCstmrStmt.Stmt?.Acct?.Id?.IBAN}/${entry.BookgDt.Dt}/${entry.AddtlNtryInf}`;

      const creditDebitIndicator = this.toString(entry?.NtryDtls?.TxDtls?.CdtDbtInd);

      let data: Partial<BankTx> = {};
      try {
        data = {
          bookingDate: new Date(entry?.BookgDt?.Dt),
          valueDate: new Date(entry?.ValDt?.Dt),
          txCount: +entry?.NtryDtls?.Btch?.NbOfTxs,
          endToEndId: this.toString(entry?.NtryDtls?.TxDtls?.Refs?.EndToEndId),
          instructionId: this.toString(entry?.NtryDtls?.TxDtls?.Refs?.InstrId),
          txId: this.toString(entry?.NtryDtls?.TxDtls?.Refs?.TxId),
          amount: +entry?.NtryDtls?.TxDtls?.Amt?.['#text'],
          currency: this.toString(entry?.NtryDtls?.TxDtls?.Amt?.['@_Ccy']),
          creditDebitIndicator,
          instructedAmount: +entry?.NtryDtls?.TxDtls?.AmtDtls?.InstdAmt?.Amt?.['#text'],
          instructedCurrency: this.toString(entry?.NtryDtls?.TxDtls?.AmtDtls?.InstdAmt?.Amt?.['@_Ccy']),
          txAmount: +entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.Amt?.['#text'],
          txCurrency: this.toString(entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.Amt?.['@_Ccy']),
          exchangeSourceCurrency: this.toString(entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.SrcCcy),
          exchangeTargetCurrency: this.toString(entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.TrgtCcy),
          exchangeRate: +entry?.NtryDtls?.TxDtls?.AmtDtls?.TxAmt?.CcyXchg?.XchgRate,
          ...(await this.getTotalCharge(
            creditDebitIndicator === SepaCdi.CREDIT ? entry?.NtryDtls?.TxDtls?.Chrgs?.Rcrd : entry?.Chrgs?.Rcrd,
          )),
          ...this.getRelatedPartyInfo(entry),
          ...this.getRelatedAgentInfo(entry),
          accountIban,
          remittanceInfo: this.toString(entry?.NtryDtls?.TxDtls?.RmtInf?.Ustrd),
          txInfo: this.toString(entry?.NtryDtls?.TxDtls?.AddtlTxInf),
        };
      } catch (e) {
        this.logger.error(`Failed to import SEPA entry data for ref ${accountServiceRef}:`, e);
      }

      return {
        accountServiceRef,
        ...data,
      };
    });
  }

  private async getTotalCharge(charges: ChargeRecord | ChargeRecord[] | undefined): Promise<{
    chargeAmount: number;
    chargeAmountChf: number;
    chargeCurrency: string;
  }> {
    let chargeAmount = 0;
    let chargeAmountChf = 0;
    const chargeCurrencies = new Set<string>();

    if (!charges) return { chargeAmount, chargeAmountChf, chargeCurrency: Config.defaults.currency };

    charges = (Array.isArray(charges) ? charges : [charges]).filter((c) => +c.Amt['#text'] !== 0);

    for (const charge of charges) {
      const currency = charge.Amt['@_Ccy'];
      const amount = charge.CdtDbtInd === SepaCdi.DEBIT ? +charge.Amt['#text'] : -+charge.Amt['#text'];

      const chargeCurrency = await this.fiatService.getFiatByName(currency);
      const chargeChfPrice = await this.pricingService.getPrice(chargeCurrency, this.chf, true);

      chargeAmount += amount;
      chargeAmountChf += chargeChfPrice.convert(amount, Config.defaultVolumeDecimal);
      chargeCurrencies.add(currency);
    }

    return {
      chargeAmount: Util.round(chargeAmount, Config.defaultVolumeDecimal),
      chargeAmountChf: Util.round(chargeAmountChf, Config.defaultVolumeDecimal),
      chargeCurrency: Array.from(chargeCurrencies).join(','),
    };
  }

  private getRelatedPartyInfo(entry: SepaEntry): Partial<BankTx> {
    const parties = entry?.NtryDtls?.TxDtls?.RltdPties;
    const { party, account, ultimateParty } =
      entry?.NtryDtls?.TxDtls?.CdtDbtInd === SepaCdi.CREDIT
        ? { party: parties?.Dbtr, account: parties?.DbtrAcct, ultimateParty: parties?.UltmtDbtr }
        : { party: parties?.Cdtr, account: parties?.CdtrAcct, ultimateParty: parties?.UltmtCdtr };

    let name = this.toString(party?.Nm);
    const address = this.getAddress(party?.PstlAdr);
    const ultimateAddress = this.getAddress(ultimateParty?.PstlAdr);
    let iban = this.toString(account?.Id?.IBAN ?? account?.Id?.Othr?.Id);

    if (!iban && name?.startsWith('/C/')) {
      iban = name?.replace('/C/', '');
      name = address.line1;
      address.line1 = address.line2;
      address.line2 = undefined;
    }

    return {
      name: name,
      addressLine1: address.line1,
      addressLine2: address.line2,
      country: address.country,
      ultimateName: this.toString(ultimateParty?.Nm),
      ultimateAddressLine1: ultimateAddress.line1,
      ultimateAddressLine2: ultimateAddress.line2,
      ultimateCountry: ultimateAddress.country,
      iban: iban,
    };
  }

  private getRelatedAgentInfo(entry: SepaEntry): Partial<BankTx> {
    const agents = entry?.NtryDtls?.TxDtls?.RltdAgts;
    const agent = entry?.NtryDtls?.TxDtls?.CdtDbtInd === SepaCdi.CREDIT ? agents?.DbtrAgt : agents?.CdtrAgt;
    const address = this.getAddress(agent?.FinInstnId?.PstlAdr);

    return {
      bic: this.toString(agent?.FinInstnId?.BICFI),
      clearingSystemId: this.toString(agent?.FinInstnId?.ClrSysMmbId?.ClrSysId?.Cd),
      memberId: this.toString(agent?.FinInstnId?.ClrSysMmbId?.MmbId),
      bankName: this.toString(agent?.FinInstnId?.Nm),
      bankAddressLine1: address.line1,
      bankAddressLine2: address.line2,
    };
  }

  private getAddress(address: SepaAddress): { line1: string; line2: string; country: string } {
    return {
      line1: this.toString(
        (Array.isArray(address?.AdrLine) ? address?.AdrLine[0] : address?.AdrLine) ??
          this.join([address?.StrtNm, address?.BldgNb]),
      ),
      line2: this.toString(
        (Array.isArray(address?.AdrLine) ? address?.AdrLine[1] : undefined) ??
          this.join([address?.PstCd, address?.TwnNm]),
      ),
      country: this.toString(address?.Ctry),
    };
  }

  private join(array: (string | undefined)[]): string | undefined {
    const join = array.filter((s) => s).join(' ');
    return join ? join : undefined;
  }

  private toString(item: unknown): string | undefined {
    return item != null ? `${item}` : undefined;
  }
}
