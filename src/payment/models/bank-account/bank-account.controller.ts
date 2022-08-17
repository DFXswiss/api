import { Controller, UseGuards, Post, UseInterceptors, UploadedFiles, Put, Param, Body, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { BankAccount } from './bank-account.entity';
import { BankAccountService } from './bank-account.service';
import { BankAccountDto } from './dto/bank-account.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@ApiTags('bankAccount')
@Controller('bankAccount')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BankAccountDto[]> {
    return this.bankAccountService.getUserBankAccounts(jwt.id).then((l) => this.toDtoList(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createBuy(
    @GetJwt() jwt: JwtPayload,
    @Body() createBankAccountDto: CreateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccountService.createBankAccount(jwt.id, createBankAccountDto).then((b) => this.toDto(b));
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateBuyRoute(
    @GetJwt() jwt: JwtPayload,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ): Promise<BankAccountDto> {
    return this.bankAccountService.updateBankAccount(jwt.id, updateBankAccountDto).then((b) => this.toDto(b));
  }

  // --- DTO --- //
  private async toDtoList(buys: BankAccount[]): Promise<BankAccountDto[]> {
    return Promise.all(buys.map((b) => this.toDto(b)));
  }

  private async toDto(buy: BankAccount): Promise<BankAccountDto> {
    return {
      ...buy,
    };
  }
}
