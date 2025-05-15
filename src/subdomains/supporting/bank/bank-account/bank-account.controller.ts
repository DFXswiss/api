import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankAccount } from './bank-account.entity';
import { BankAccountService } from './bank-account.service';
import { BankAccountDto } from './dto/bank-account.dto';
import { CreateBankAccountDto, CreateBankAccountInternalDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@ApiTags('Bank Account')
@Controller('bankAccount')
export class BankAccountController {
  constructor(
    private readonly bankDataService: BankDataService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: BankAccountDto, isArray: true })
  async getAllUserBankAccount(@GetJwt() jwt: JwtPayload): Promise<BankAccountDto[]> {
    return this.bankDataService.getValidBankDatasForUser(jwt.account).then((l) => this.toDtoList(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ type: BankAccountDto })
  async createBankAccount(@GetJwt() jwt: JwtPayload, @Body() dto: CreateBankAccountDto): Promise<BankAccountDto> {
    return this.bankDataService.createIbanForUser(jwt.account, dto).then((b) => this.toDto(b));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: BankAccountDto })
  async updateBankAccount(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankDataService.updateUserBankData(+id, jwt.account, dto).then((b) => this.toDto(b));
  }

  // --- IBAN --- //
  @Post('iban')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async addBankAccountIban(@Body() dto: CreateBankAccountInternalDto): Promise<BankAccount> {
    return this.bankAccountService.getOrCreateBankAccountInternal(dto.iban);
  }

  // --- DTO --- //
  private toDtoList(bankDatas: BankData[]): BankAccountDto[] {
    const uniqueActiveBankDatas = Array.from(
      new Map(bankDatas.filter((b) => b.active).map((item) => [item.iban, item])).values(),
    );
    return uniqueActiveBankDatas.map((b) => this.toDto(b));
  }

  private toDto(bankData: BankData): BankAccountDto {
    return {
      id: bankData.id,
      iban: bankData.iban.split(';')[0],
      label: bankData.label,
      preferredCurrency: bankData.preferredCurrency ? FiatDtoMapper.toDto(bankData.preferredCurrency) : null,
    };
  }
}
