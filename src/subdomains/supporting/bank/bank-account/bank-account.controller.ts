import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankAccount } from './bank-account.entity';
import { BankAccountService } from './bank-account.service';
import { BankAccountDto } from './dto/bank-account.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateIbanDto, IbanDto } from './dto/iban.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@ApiTags('Bank Account')
@Controller('bankAccount')
export class BankAccountController {
  constructor(
    private readonly bankAccountService: BankAccountService,
    private readonly bankDataService: BankDataService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: BankAccountDto, isArray: true })
  async getAllUserBankAccount(@GetJwt() jwt: JwtPayload): Promise<BankAccountDto[]> {
    return this.bankAccountService.getUserBankAccounts(jwt.account).then((l) => this.toDtoList(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: BankAccountDto })
  async createBankAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() createBankAccountDto: CreateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccountService.createBankAccount(jwt.account, createBankAccountDto).then((b) => this.toDto(b));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: BankAccountDto })
  async updateBankAccount(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccountService.updateBankAccount(+id, jwt.account, updateBankAccountDto).then((b) => this.toDto(b));
  }

  // --- IBAN --- //

  @Get('iban')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiExcludeEndpoint()
  async getAllUserIban(@GetJwt() jwt: JwtPayload): Promise<IbanDto[]> {
    const ibans = await this.bankDataService.getIbansForUser(jwt.account);

    return ibans.map((iban) => ({ iban }));
  }

  @Post('iban')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiExcludeEndpoint()
  async addUserIban(@GetJwt() jwt: JwtPayload, @Body() dto: CreateIbanDto): Promise<void> {
    return this.bankDataService.createIbanForUser(jwt.account, dto.iban);
  }

  // --- DTO --- //
  private async toDtoList(bankAccounts: BankAccount[]): Promise<BankAccountDto[]> {
    return Promise.all(bankAccounts.map((b) => this.toDto(b)));
  }

  private async toDto(bankAccount: BankAccount): Promise<BankAccountDto> {
    return {
      id: bankAccount.id,
      iban: bankAccount.iban,
      label: bankAccount.label,
      preferredCurrency: bankAccount.preferredCurrency,
      sepaInstant: bankAccount.sctInst ?? false,
      active: bankAccount.active,
    };
  }
}
