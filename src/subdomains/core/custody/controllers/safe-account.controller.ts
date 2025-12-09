import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSafeAccountDto } from '../dto/input/create-safe-account.dto';
import { UpdateSafeAccountDto } from '../dto/input/update-safe-account.dto';
import { SafeAccountAccessDto, SafeAccountDto } from '../dto/output/safe-account.dto';
import { SafeAccountReadGuard, SafeAccountWriteGuard } from '../guards/safe-account-access.guard';
import { SafeAccountService } from '../services/safe-account.service';

@ApiTags('SafeAccount')
@Controller('safe-account')
export class SafeAccountController {
  constructor(private readonly safeAccountService: SafeAccountService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: [SafeAccountDto], description: 'List of SafeAccounts for the user' })
  async getSafeAccounts(@GetJwt() jwt: JwtPayload): Promise<SafeAccountDto[]> {
    return this.safeAccountService.getSafeAccountsForUser(jwt.account);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), SafeAccountReadGuard)
  @ApiOkResponse({ type: SafeAccountDto, description: 'SafeAccount details' })
  async getSafeAccount(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SafeAccountDto> {
    const safeAccountId = id === 'legacy' ? null : +id;
    const safeAccounts = await this.safeAccountService.getSafeAccountsForUser(jwt.account);

    if (safeAccountId === null) {
      const legacy = safeAccounts.find((sa) => sa.isLegacy);
      if (!legacy) throw new Error('No legacy safe account found');
      return legacy;
    }

    const safeAccount = safeAccounts.find((sa) => sa.id === safeAccountId);
    if (!safeAccount) throw new Error('SafeAccount not found');
    return safeAccount;
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ type: SafeAccountDto, description: 'Create a new SafeAccount' })
  async createSafeAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateSafeAccountDto,
  ): Promise<SafeAccountDto> {
    const safeAccount = await this.safeAccountService.createSafeAccount(
      jwt.account,
      dto.title,
      dto.description,
    );

    return {
      id: safeAccount.id,
      title: safeAccount.title,
      description: safeAccount.description,
      isLegacy: false,
      accessLevel: 'Write' as any,
      owner: { id: jwt.account },
    };
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), SafeAccountWriteGuard)
  @ApiOkResponse({ type: SafeAccountDto, description: 'Update SafeAccount' })
  async updateSafeAccount(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSafeAccountDto,
  ): Promise<SafeAccountDto> {
    const safeAccount = await this.safeAccountService.updateSafeAccount(
      +id,
      jwt.account,
      dto.title,
      dto.description,
    );

    return {
      id: safeAccount.id,
      title: safeAccount.title,
      description: safeAccount.description,
      isLegacy: false,
      accessLevel: 'Write' as any,
      owner: safeAccount.owner ? { id: safeAccount.owner.id } : undefined,
    };
  }

  @Get(':id/access')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), SafeAccountReadGuard)
  @ApiOkResponse({ type: [SafeAccountAccessDto], description: 'List of users with access' })
  async getAccessList(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
  ): Promise<SafeAccountAccessDto[]> {
    const accessList = await this.safeAccountService.getAccessList(+id, jwt.account);

    return accessList.map((access) => ({
      id: access.id,
      userDataId: access.userData.id,
      accessLevel: access.accessLevel,
    }));
  }
}
