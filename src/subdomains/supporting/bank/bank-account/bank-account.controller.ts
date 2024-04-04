import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankAccount } from './bank-account.entity';
import { BankAccountService } from './bank-account.service';
import { BankAccountDto } from './dto/bank-account.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateIbanDto, IbanDto } from './dto/iban.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@ApiTags('BankAccount')
@Controller('bankAccount')
export class BankAccountController {
  constructor(
    private readonly bankAccountService: BankAccountService,
    private readonly userService: UserService,
    private readonly bankDataService: BankDataService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: BankAccountDto, isArray: true })
  async getAllUserBankAccount(@GetJwt() jwt: JwtPayload): Promise<BankAccountDto[]> {
    return this.bankAccountService.getUserBankAccounts(jwt.id).then((l) => this.toDtoList(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: BankAccountDto })
  async createBankAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() createBankAccountDto: CreateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccountService.createBankAccount(jwt.id, createBankAccountDto).then((b) => this.toDto(b));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: BankAccountDto })
  async updateBankAccount(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccountService.updateBankAccount(+id, jwt.id, updateBankAccountDto).then((b) => this.toDto(b));
  }

  // --- IBAN --- //

  @Get('iban')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getAllUserIban(@GetJwt() jwt: JwtPayload): Promise<IbanDto[]> {
    const user = await this.userService.getUser(jwt.id, { userData: true });
    const ibans = await this.bankDataService.getIbansForUser(user.userData.id);

    return ibans.map((iban) => ({ iban }));
  }

  @Post('iban')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async addUserIban(@GetJwt() jwt: JwtPayload, @Body() dto: CreateIbanDto): Promise<void> {
    const user = await this.userService.getUser(jwt.id, { userData: true });
    return this.bankDataService.createIbanForUser(user.userData.id, dto.iban);
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
