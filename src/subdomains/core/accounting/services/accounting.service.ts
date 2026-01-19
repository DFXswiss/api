import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Util } from 'src/shared/utils/util';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankBalanceSheetDto, DetailedBalanceSheetDto, TypeBreakdownDto } from '../dto/accounting-report.dto';

@Injectable()
export class AccountingService {
  constructor(
    @InjectRepository(Bank) private readonly bankRepo: Repository<Bank>,
    @InjectRepository(BankTx) private readonly bankTxRepo: Repository<BankTx>,
  ) {}

  async getBankBalanceSheet(iban: string, year: number): Promise<BankBalanceSheetDto> {
    // Find the bank by IBAN
    const bank = await this.bankRepo.findOne({ where: { iban } });
    if (!bank) {
      throw new NotFoundException(`Bank with IBAN ${iban} not found`);
    }

    // Parse yearly balances from JSON: { "2024": 1234.56, "2025": 0 }
    // Each year stores only the closing balance
    const yearlyBalances: Record<string, number> = bank.yearlyBalances
      ? JSON.parse(bank.yearlyBalances)
      : {};

    // Opening balance = previous year's closing balance
    const previousYear = (year - 1).toString();
    const openingBalance = yearlyBalances[previousYear] ?? 0;

    // Date range for the year
    const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)); // January 1st 00:00:00.000 UTC
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)); // December 31st 23:59:59.999 UTC

    // Get total income (CRDT transactions)
    const incomeResult = await this.bankTxRepo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.accountIban = :iban', { iban })
      .andWhere('tx.valueDate >= :from', { from })
      .andWhere('tx.valueDate <= :to', { to })
      .andWhere('tx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.CREDIT })
      .getRawOne();

    // Get total expenses (DBIT transactions)
    const expensesResult = await this.bankTxRepo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.accountIban = :iban', { iban })
      .andWhere('tx.valueDate >= :from', { from })
      .andWhere('tx.valueDate <= :to', { to })
      .andWhere('tx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.DEBIT })
      .getRawOne();

    const totalIncome = parseFloat(incomeResult?.total ?? '0');
    const totalExpenses = parseFloat(expensesResult?.total ?? '0');

    // Calculate closing balance: opening + income - expenses
    const calculatedClosingBalance = Util.round(openingBalance + totalIncome - totalExpenses, 2);

    // Check if defined closing balance exists and matches
    const definedClosingBalance = yearlyBalances[year.toString()];
    const hasDefinedClosingBalance = definedClosingBalance !== undefined;
    const balanceMatches = hasDefinedClosingBalance
      ? Math.abs(calculatedClosingBalance - definedClosingBalance) < 0.01
      : true;

    return {
      bankName: bank.name,
      currency: bank.currency,
      iban: bank.iban,
      year,
      openingBalance: Util.round(openingBalance, 2),
      totalIncome: Util.round(totalIncome, 2),
      totalExpenses: Util.round(totalExpenses, 2),
      calculatedClosingBalance,
      definedClosingBalance: hasDefinedClosingBalance ? Util.round(definedClosingBalance, 2) : undefined,
      balanceMatches,
      hasDefinedClosingBalance,
    };
  }

  async getDetailedBalanceSheet(iban: string, year: number): Promise<DetailedBalanceSheetDto> {
    // Find the bank by IBAN
    const bank = await this.bankRepo.findOne({ where: { iban } });
    if (!bank) {
      throw new NotFoundException(`Bank with IBAN ${iban} not found`);
    }

    // Parse yearly balances
    const yearlyBalances: Record<string, number> = bank.yearlyBalances
      ? JSON.parse(bank.yearlyBalances)
      : {};

    // Opening balance = previous year's closing balance
    const previousYear = (year - 1).toString();
    const openingBalance = yearlyBalances[previousYear] ?? 0;

    // Date range for the year
    const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    // Get income breakdown by type (CRDT transactions)
    const incomeByTypeResult = await this.bankTxRepo
      .createQueryBuilder('tx')
      .select('COALESCE(tx.type, \'Unknown\')', 'type')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'amount')
      .addSelect('COUNT(*)', 'count')
      .where('tx.accountIban = :iban', { iban })
      .andWhere('tx.valueDate >= :from', { from })
      .andWhere('tx.valueDate <= :to', { to })
      .andWhere('tx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.CREDIT })
      .groupBy('tx.type')
      .orderBy('amount', 'DESC')
      .getRawMany();

    // Get expenses breakdown by type (DBIT transactions)
    const expensesByTypeResult = await this.bankTxRepo
      .createQueryBuilder('tx')
      .select('COALESCE(tx.type, \'Unknown\')', 'type')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'amount')
      .addSelect('COUNT(*)', 'count')
      .where('tx.accountIban = :iban', { iban })
      .andWhere('tx.valueDate >= :from', { from })
      .andWhere('tx.valueDate <= :to', { to })
      .andWhere('tx.creditDebitIndicator = :indicator', { indicator: BankTxIndicator.DEBIT })
      .groupBy('tx.type')
      .orderBy('amount', 'DESC')
      .getRawMany();

    // Map results to DTOs
    const incomeByType: TypeBreakdownDto[] = incomeByTypeResult.map((r) => ({
      type: r.type || 'Unknown',
      amount: Util.round(parseFloat(r.amount), 2),
      count: parseInt(r.count, 10),
    }));

    const expensesByType: TypeBreakdownDto[] = expensesByTypeResult.map((r) => ({
      type: r.type || 'Unknown',
      amount: Util.round(parseFloat(r.amount), 2),
      count: parseInt(r.count, 10),
    }));

    // Calculate totals
    const totalIncome = incomeByType.reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = expensesByType.reduce((sum, t) => sum + t.amount, 0);
    const calculatedClosingBalance = Util.round(openingBalance + totalIncome - totalExpenses, 2);

    // Check defined closing balance
    const definedClosingBalance = yearlyBalances[year.toString()];
    const hasDefinedClosingBalance = definedClosingBalance !== undefined;
    const balanceMatches = hasDefinedClosingBalance
      ? Math.abs(calculatedClosingBalance - definedClosingBalance) < 0.01
      : true;

    return {
      bankName: bank.name,
      currency: bank.currency,
      iban: bank.iban,
      year,
      openingBalance: Util.round(openingBalance, 2),
      incomeByType,
      expensesByType,
      totalIncome: Util.round(totalIncome, 2),
      totalExpenses: Util.round(totalExpenses, 2),
      calculatedClosingBalance,
      definedClosingBalance: hasDefinedClosingBalance ? Util.round(definedClosingBalance, 2) : undefined,
      balanceMatches,
      hasDefinedClosingBalance,
    };
  }
}
