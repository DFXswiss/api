import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { VirtualIbanDto } from '../virtual-iban/dto/virtual-iban.dto';
import { VirtualIbanMapper } from '../virtual-iban/dto/virtual-iban.mapper';
import { VirtualIbanService } from '../virtual-iban/virtual-iban.service';
import { BankService } from './bank.service';
import { BankDto } from './dto/bank.dto';
import { BankMapper } from './dto/bank.mapper';

@ApiTags('Bank')
@Controller('bank')
export class BankController {
  constructor(
    private readonly bankService: BankService,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  @Get()
  @ApiOkResponse({ type: BankDto, isArray: true })
  async getAllBanks(): Promise<BankDto[]> {
    const banks = await this.bankService.getAllBanks();

    return banks.map(BankMapper.toDto);
  }

  @Get('vIban')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: BankDto, isArray: true })
  async getAllPersonalBanks(@GetJwt() jwt: JwtPayload): Promise<VirtualIbanDto[]> {
    const vIbans = await this.virtualIbanService.getVirtualIbanForUser(jwt.account);

    return vIbans.map(VirtualIbanMapper.toDto);
  }
}
