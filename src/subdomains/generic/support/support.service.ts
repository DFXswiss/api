import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { isIP } from 'class-validator';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { RefundDataDto } from 'src/subdomains/core/history/dto/refund-data.dto';
import { BankRefundDto } from 'src/subdomains/core/history/dto/transaction-refund.dto';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import {
  BankTx,
  BankTxType,
  BankTxTypeUnassigned,
} from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { KycStep } from '../kyc/entities/kyc-step.entity';
import { KycFileService } from '../kyc/services/kyc-file.service';
import { KycService } from '../kyc/services/kyc.service';
import { BankData } from '../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../user/models/bank-data/bank-data.service';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { User } from '../user/models/user/user.entity';
import { UserService } from '../user/models/user/user.service';
import {
  BankDataSupportInfo,
  BankTxSupportInfo,
  BuySupportInfo,
  ComplianceSearchType,
  KycStepSupportInfo,
  SellSupportInfo,
  TransactionSupportInfo,
  UserDataSupportInfo,
  UserDataSupportInfoDetails,
  UserDataSupportInfoResult,
  UserDataSupportQuery,
  UserSupportInfo,
} from './dto/user-data-support.dto';

interface UserDataComplianceSearchTypePair {
  type: ComplianceSearchType;
  userData: UserData;
}

@Injectable()
export class SupportService {
  private readonly refundList = new Map<number, RefundDataDto>();

  constructor(
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly swapService: SwapService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly bankTxService: BankTxService,
    private readonly payInService: PayInService,
    private readonly kycFileService: KycFileService,
    private readonly kycService: KycService,
    private readonly bankDataService: BankDataService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly transactionService: TransactionService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly bankService: BankService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
  ) {}

  async getUserDataDetails(id: number): Promise<UserDataSupportInfoDetails> {
    const userData = await this.userDataService.getUserData(id, { wallet: true, bankDatas: true });
    if (!userData) throw new NotFoundException(`User not found`);

    // Load all related data in parallel
    const [kycFiles, kycSteps, transactions, users, bankDatas, buyRoutes, sellRoutes] = await Promise.all([
      this.kycFileService.getUserDataKycFiles(id),
      this.kycService.getStepsByUserData(id),
      this.transactionService.getTransactionsByUserDataId(id),
      this.userService.getAllUserDataUsers(id),
      this.bankDataService.getBankDatasByUserData(id),
      this.buyService.getUserDataBuys(id),
      this.sellService.getSellsByUserDataId(id),
    ]);

    return {
      userData,
      kycFiles,
      kycSteps: kycSteps.map((s) => this.toKycStepSupportInfo(s)),
      transactions: transactions.map((t) => this.toTransactionSupportInfo(t)),
      users: users.map((u) => this.toUserSupportInfo(u)),
      bankDatas: bankDatas.map((b) => this.toBankDataSupportInfo(b)),
      buyRoutes: buyRoutes.map((b) => this.toBuySupportInfo(b)),
      sellRoutes: sellRoutes.map((s) => this.toSellSupportInfo(s)),
    };
  }

  // --- MAPPING METHODS --- //

  private toKycStepSupportInfo(step: KycStep): KycStepSupportInfo {
    return {
      id: step.id,
      name: step.name,
      type: step.type,
      status: step.status,
      sequenceNumber: step.sequenceNumber,
      created: step.created,
    };
  }

  private toTransactionSupportInfo(tx: Transaction): TransactionSupportInfo {
    return {
      id: tx.id,
      uid: tx.uid,
      type: tx.type,
      sourceType: tx.sourceType,
      amountInChf: tx.amountInChf,
      amlCheck: tx.amlCheck,
      created: tx.created,
    };
  }

  private toUserSupportInfo(user: User): UserSupportInfo {
    return {
      id: user.id,
      address: user.address,
      role: user.role,
      status: user.status,
      created: user.created,
    };
  }

  private toBankDataSupportInfo(bankData: BankData): BankDataSupportInfo {
    return {
      id: bankData.id,
      iban: bankData.iban,
      name: bankData.name,
      approved: bankData.approved,
    };
  }

  private toBuySupportInfo(buy: Buy): BuySupportInfo {
    return {
      id: buy.id,
      bankUsage: buy.bankUsage,
      assetName: buy.asset?.name,
      blockchain: buy.asset?.blockchain,
      volume: buy.volume,
      active: buy.active,
    };
  }

  private toSellSupportInfo(sell: Sell): SellSupportInfo {
    return {
      id: sell.id,
      iban: sell.iban,
      fiatName: sell.fiat?.name,
      volume: sell.annualVolume,
    };
  }

  async searchUserDataByKey(query: UserDataSupportQuery): Promise<UserDataSupportInfoResult> {
    const searchResult = await this.getUserDatasByKey(query.key);
    const bankTx = [ComplianceSearchType.IBAN, ComplianceSearchType.VIRTUAL_IBAN].includes(searchResult.type)
      ? await this.bankTxService.getUnassignedBankTx([query.key], [query.key])
      : searchResult.type === ComplianceSearchType.NAME
        ? await this.bankTxService.getBankTxsByName(query.key)
        : [];

    if (
      !searchResult.userDatas.length &&
      (!bankTx.length ||
        ![ComplianceSearchType.IBAN, ComplianceSearchType.VIRTUAL_IBAN, ComplianceSearchType.NAME].includes(
          searchResult.type,
        ))
    )
      throw new NotFoundException('No user or bankTx found');

    return {
      type: searchResult.type,
      userDatas: Util.toUniqueList(searchResult.userDatas, 'id')
        .sort((a, b) => a.id - b.id)
        .map((u) => this.toUserDataDto(u)),
      bankTx: bankTx.sort((a, b) => a.id - b.id).map((b) => this.toBankTxDto(b)),
    };
  }

  //*** HELPER METHODS ***//

  private async getUserDatasByKey(key: string): Promise<{ type: ComplianceSearchType; userDatas: UserData[] }> {
    if (key.includes('@'))
      return { type: ComplianceSearchType.MAIL, userDatas: await this.userDataService.getUsersByMail(key, false) };

    if (Config.formats.phone.test(key))
      return { type: ComplianceSearchType.PHONE, userDatas: await this.userDataService.getUsersByPhone(key) };

    if (isIP(key)) {
      const userDatas = await this.userService.getUsersByIp(key).then((u) => u.map((u) => u.userData));
      return { type: ComplianceSearchType.IP, userDatas };
    }

    const uniqueSearchResult = await this.getUniqueUserDataByKey(key);
    if (uniqueSearchResult.userData) return { type: uniqueSearchResult.type, userDatas: [uniqueSearchResult.userData] };

    if (IbanTools.validateIBAN(key).valid) {
      const virtualIban = await this.virtualIbanService.getByIban(key);
      if (virtualIban) {
        const bankTxUserDatas = await this.bankTxService
          .getBankTxsByVirtualIban(key)
          .then((txs) => txs.map((tx) => tx.userData));

        return { type: ComplianceSearchType.VIRTUAL_IBAN, userDatas: [...bankTxUserDatas, virtualIban.userData] };
      }

      // Normal IBAN search
      const userDatas = await Promise.all([
        this.bankDataService.getBankDatasByIban(key),
        this.bankTxReturnService.getBankTxReturnsByIban(key),
        this.buyCryptoService.getBuyCryptosByChargebackIban(key),
        this.sellService.getSellsByIban(key),
      ]).then((t) => t.flat().map((t) => t.userData));

      return { type: ComplianceSearchType.IBAN, userDatas };
    }

    // min requirement for a name
    if (key.length >= 2)
      return { type: ComplianceSearchType.NAME, userDatas: await this.userDataService.getUsersByName(key) };

    return { type: undefined, userDatas: [] };
  }

  private async getUniqueUserDataByKey(key: string): Promise<UserDataComplianceSearchTypePair> {
    if (Config.formats.number.test(key)) {
      const userData = await this.userDataService.getUserData(+key);
      if (userData) return { type: ComplianceSearchType.USER_DATA_ID, userData };
    }

    if (Config.formats.kycHash.test(key))
      return {
        type: ComplianceSearchType.KYC_HASH,
        userData: await this.userDataService.getUserDataByKey('kycHash', key),
      };

    if (Config.formats.transactionUid.test(key))
      return {
        type: ComplianceSearchType.TRANSACTION_UID,
        userData: await this.transactionService.getTransactionByKey('uid', key).then((t) => t?.userData),
      };

    if (Config.formats.bankUsage.test(key))
      return {
        type: ComplianceSearchType.BANK_USAGE,
        userData: await this.buyService.getBuyByKey('bankUsage', key, true).then((b) => b?.userData),
      };

    if (Config.formats.ref.test(key))
      return {
        type: ComplianceSearchType.REF,
        userData: await this.userService.getUserByKey('ref', key, true).then((u) => u?.userData),
      };

    if (Config.formats.accountServiceRef.test(key))
      return {
        type: ComplianceSearchType.ACCOUNT_SERVICE_REF,
        userData: await this.bankTxService.getBankTxByKey('accountServiceRef', key, true).then((b) => b?.userData),
      };

    if (Config.formats.address.test(key)) {
      const user = await this.userService.getUserByKey('address', key, true);
      if (user) return { type: ComplianceSearchType.USER_ADDRESS, userData: user.userData };

      return Promise.all([
        this.sellService.getSellByKey('deposit.address', key, true),
        this.swapService.getSwapByKey('deposit.address', key, true),
      ]).then((s) => {
        return { type: ComplianceSearchType.DEPOSIT_ADDRESS, userData: s.find((s) => s)?.userData };
      });
    }

    return Promise.all([
      this.buyCryptoService.getBuyCryptoByKeys(['txId', 'chargebackCryptoTxId'], key, true),
      this.buyFiatService.getBuyFiatByKey('chargebackTxId', key, true),
      this.payInService.getCryptoInputByKeys(['inTxId', 'outTxId', 'returnTxId'], key),
    ]).then((us) => {
      return { type: ComplianceSearchType.TXID, userData: us.find((u) => u)?.userData };
    });
  }

  private toUserDataDto(userData: UserData): UserDataSupportInfo {
    const name =
      userData.verifiedName ??
      ([userData.firstname, userData.surname, userData.organization?.name].filter(Boolean).join(' ') || undefined);

    return {
      id: userData.id,
      kycStatus: userData.kycStatus,
      accountType: userData.accountType,
      mail: userData.mail,
      name,
    };
  }

  private toBankTxDto(bankTx: BankTx): BankTxSupportInfo {
    return {
      id: bankTx.id,
      transactionId: bankTx.transaction?.id,
      accountServiceRef: bankTx.accountServiceRef,
      amount: bankTx.amount,
      currency: bankTx.currency,
      type: bankTx.type,
      name: bankTx.completeName(),
      iban: bankTx.iban,
    };
  }

  // --- REFUND METHODS --- //

  async getTransactionRefundData(transactionId: number): Promise<RefundDataDto | undefined> {
    const transaction = await this.transactionService.getTransactionById(transactionId, {
      bankTx: { bankTxReturn: true },
      userData: true,
    });

    if (!transaction?.bankTx) return undefined;
    if (!BankTxTypeUnassigned(transaction.bankTx.type)) return undefined;
    if (transaction.bankTx.bankTxReturn) throw new BadRequestException('Transaction already has a return');

    const bankIn = await this.bankService.getBankByIban(transaction.bankTx.accountIban).then((b) => b?.name);
    const refundTarget = transaction.bankTx.iban;

    const refundData = await this.transactionHelper.getRefundData(
      transaction.bankTx,
      transaction.userData,
      bankIn,
      refundTarget,
      true,
    );

    this.refundList.set(transactionId, refundData);

    return refundData;
  }

  async processTransactionRefund(transactionId: number, dto: BankRefundDto): Promise<boolean> {
    const transaction = await this.transactionService.getTransactionById(transactionId, {
      bankTx: { bankTxReturn: true },
      bankTxReturn: { bankTx: true, chargebackOutput: true },
      userData: true,
    });

    if (!transaction?.bankTx) throw new NotFoundException('Transaction not found');
    if (!BankTxTypeUnassigned(transaction.bankTx.type)) throw new BadRequestException('Transaction already assigned');

    const refundData = this.refundList.get(transactionId);
    if (!refundData) throw new BadRequestException('Request refund data first');
    if (!this.isRefundDataValid(refundData)) throw new BadRequestException('Refund data expired');
    this.refundList.delete(transactionId);

    // Create BankTxReturn if not exists
    if (!transaction.bankTxReturn) {
      // Load bankTx with transaction relation for the create method
      const bankTxWithRelations = await this.bankTxService.getBankTxById(transaction.bankTx.id, {
        transaction: { userData: true },
      });

      transaction.bankTxReturn = await this.bankTxService
        .updateInternal(bankTxWithRelations, { type: BankTxType.BANK_TX_RETURN })
        .then((b) => b.bankTxReturn);
    }

    // Process refund
    await this.bankTxReturnService.refundBankTx(transaction.bankTxReturn, {
      refundIban: dto.refundTarget,
      chargebackAmount: refundData.refundAmount,
      chargebackAllowedDate: new Date(),
      chargebackAllowedBy: 'Compliance',
      creditorData: {
        name: dto.name,
        address: dto.address,
        houseNumber: dto.houseNumber,
        zip: dto.zip,
        city: dto.city,
        country: dto.country,
      },
    });

    return true;
  }

  private isRefundDataValid(refundData: RefundDataDto): boolean {
    return Util.secondsDiff(refundData.expiryDate) <= 0;
  }
}
