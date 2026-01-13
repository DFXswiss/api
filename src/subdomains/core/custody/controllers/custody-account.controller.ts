import { Body, Controller, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { UpdateCustodyAccountDto } from '../dto/input/update-custody-account.dto';
import { CustodyAccountAccessDto, CustodyAccountDto } from '../dto/output/custody-account.dto';
import { CustodyAccessLevel } from '../enums/custody';
import { CustodyAccountReadGuard, CustodyAccountWriteGuard } from '../guards/custody-account-access.guard';
import { CustodyAccountDtoMapper } from '../mappers/custody-account-dto.mapper';
import { CustodyAccountService } from '../services/custody-account.service';

@ApiTags('Custody')
@Controller('custody/account')
export class CustodyAccountController {
  constructor(private readonly custodyAccountService: CustodyAccountService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: [CustodyAccountDto], description: 'List of custody accounts for the user' })
  async getCustodyAccounts(@GetJwt() jwt: JwtPayload): Promise<CustodyAccountDto[]> {
    return this.custodyAccountService.getCustodyAccountsForUser(jwt.account);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: CustodyAccountDto, description: 'Custody account details' })
  async getCustodyAccount(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyAccountDto> {
    const custodyAccounts = await this.custodyAccountService.getCustodyAccountsForUser(jwt.account);

    const isLegacy = id === 'legacy';
    const account = isLegacy ? custodyAccounts.find((ca) => ca.isLegacy) : custodyAccounts.find((ca) => ca.id === +id);
    if (!account) throw new NotFoundException(`${isLegacy ? 'Legacy' : 'Custody'} account not found`);

    return account;
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ type: CustodyAccountDto, description: 'Create a new custody account' })
  async createCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateCustodyAccountDto,
  ): Promise<CustodyAccountDto> {
    const custodyAccount = await this.custodyAccountService.createCustodyAccount(
      jwt.account,
      dto.title,
      dto.description,
    );

    return CustodyAccountDtoMapper.toDto(custodyAccount, CustodyAccessLevel.WRITE);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountWriteGuard)
  @ApiOkResponse({ type: CustodyAccountDto, description: 'Update custody account' })
  async updateCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCustodyAccountDto,
  ): Promise<CustodyAccountDto> {
    const custodyAccount = await this.custodyAccountService.updateCustodyAccount(
      +id,
      jwt.account,
      dto.title,
      dto.description,
    );

    return CustodyAccountDtoMapper.toDto(custodyAccount, CustodyAccessLevel.WRITE);
  }

  @Get(':id/access')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: [CustodyAccountAccessDto], description: 'List of users with access' })
  async getAccessList(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyAccountAccessDto[]> {
    const accessList = await this.custodyAccountService.getAccessList(+id, jwt.account);

    return accessList.map((access) => ({
      id: access.id,
      user: { id: access.userData.id },
      accessLevel: access.accessLevel,
    }));
  }
}
