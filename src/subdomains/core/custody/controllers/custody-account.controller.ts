import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
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
import { CustodyAccountReadGuard, CustodyAccountWriteGuard } from '../guards/custody-account-access.guard';
import { CustodyAccountService } from '../services/custody-account.service';

@ApiTags('Custody')
@Controller('custody/account')
export class CustodyAccountController {
  constructor(private readonly custodyAccountService: CustodyAccountService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: [CustodyAccountDto], description: 'List of CustodyAccounts for the user' })
  async getCustodyAccounts(@GetJwt() jwt: JwtPayload): Promise<CustodyAccountDto[]> {
    return this.custodyAccountService.getCustodyAccountsForUser(jwt.account);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: CustodyAccountDto, description: 'CustodyAccount details' })
  async getCustodyAccount(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyAccountDto> {
    const custodyAccountId = id === 'legacy' ? null : +id;
    const custodyAccounts = await this.custodyAccountService.getCustodyAccountsForUser(jwt.account);

    if (custodyAccountId === null) {
      const legacy = custodyAccounts.find((ca) => ca.isLegacy);
      if (!legacy) throw new Error('No legacy custody account found');
      return legacy;
    }

    const custodyAccount = custodyAccounts.find((ca) => ca.id === custodyAccountId);
    if (!custodyAccount) throw new Error('CustodyAccount not found');
    return custodyAccount;
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ type: CustodyAccountDto, description: 'Create a new CustodyAccount' })
  async createCustodyAccount(@GetJwt() jwt: JwtPayload, @Body() dto: CreateCustodyAccountDto): Promise<CustodyAccountDto> {
    const custodyAccount = await this.custodyAccountService.createCustodyAccount(jwt.account, dto.title, dto.description);

    return {
      id: custodyAccount.id,
      title: custodyAccount.title,
      description: custodyAccount.description,
      isLegacy: false,
      accessLevel: 'Write' as any,
      owner: { id: jwt.account },
    };
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountWriteGuard)
  @ApiOkResponse({ type: CustodyAccountDto, description: 'Update CustodyAccount' })
  async updateCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCustodyAccountDto,
  ): Promise<CustodyAccountDto> {
    const custodyAccount = await this.custodyAccountService.updateCustodyAccount(+id, jwt.account, dto.title, dto.description);

    return {
      id: custodyAccount.id,
      title: custodyAccount.title,
      description: custodyAccount.description,
      isLegacy: false,
      accessLevel: 'Write' as any,
      owner: custodyAccount.owner ? { id: custodyAccount.owner.id } : undefined,
    };
  }

  @Get(':id/access')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: [CustodyAccountAccessDto], description: 'List of users with access' })
  async getAccessList(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyAccountAccessDto[]> {
    const accessList = await this.custodyAccountService.getAccessList(+id, jwt.account);

    return accessList.map((access) => ({
      id: access.id,
      userDataId: access.userData.id,
      accessLevel: access.accessLevel,
    }));
  }
}
