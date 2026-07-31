import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { PdfDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/pdf.dto';
import { CreateCustodyAccountAccessDto } from '../dto/input/create-custody-account-access.dto';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { GetCustodyPdfDto } from '../dto/input/get-custody-pdf.dto';
import { UpdateCustodyAccountAccessDto } from '../dto/input/update-custody-account-access.dto';
import { UpdateCustodyAccountDto } from '../dto/input/update-custody-account.dto';
import { CustodyAccountAccessDto, CustodyAccountDto } from '../dto/output/custody-account.dto';
import { CustodyBalanceDto, CustodyHistoryDto } from '../dto/output/custody-balance.dto';
import { CustodyOrderHistoryDto } from '../dto/output/custody-order-history.dto';
import { CustodyAccessLevel } from '../enums/custody';
import { CustodyAccountReadGuard, CustodyAccountWriteGuard } from '../guards/custody-account-access.guard';
import { CustodyAccountDtoMapper } from '../mappers/custody-account-dto.mapper';
import { CustodyAccountId, CustodyAccountService, LegacyAccountId } from '../services/custody-account.service';
import { CustodyOrderService } from '../services/custody-order.service';
import { CustodyPdfService } from '../services/custody-pdf.service';
import { CustodyService } from '../services/custody.service';

@ApiTags('Custody')
@Controller('custody/account')
export class CustodyAccountController {
  constructor(
    private readonly custodyAccountService: CustodyAccountService,
    private readonly custodyService: CustodyService,
    private readonly custodyOrderService: CustodyOrderService,
    private readonly custodyPdfService: CustodyPdfService,
  ) {}

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

    const isLegacy = id === LegacyAccountId;
    const account = isLegacy
      ? custodyAccounts.find((ca) => ca.isLegacy)
      : custodyAccounts.find((ca) => ca.id === this.parsePositiveIntParam(id, 'custody account ID'));
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

    // The caller just created it, so it is theirs by definition.
    return CustodyAccountDtoMapper.toDto(custodyAccount, CustodyAccessLevel.WRITE, true);
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
      this.parsePositiveIntParam(id, 'custody account ID'),
      jwt.account,
      dto.title,
      dto.description,
    );

    // Reached through the write guard, which a grantee passes too — ownership is a separate
    // question from the level and has to be answered from the account itself.
    return CustodyAccountDtoMapper.toDto(
      custodyAccount,
      CustodyAccessLevel.WRITE,
      custodyAccount.isOwnedBy(jwt.account),
    );
  }

  @Get(':id/balance')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: CustodyBalanceDto, description: 'Custody balance of the addressed account' })
  async getAccountBalance(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyBalanceDto> {
    const ownerAccountId = await this.custodyAccountService.resolveOwnerAccountId(
      this.parseCustodyAccountId(id),
      jwt.account,
    );

    return this.custodyService.getUserCustodyBalance(ownerAccountId);
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: CustodyHistoryDto, description: 'Custody history of the addressed account' })
  async getAccountHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyHistoryDto> {
    const ownerAccountId = await this.custodyAccountService.resolveOwnerAccountId(
      this.parseCustodyAccountId(id),
      jwt.account,
    );

    return this.custodyService.getUserCustodyHistory(ownerAccountId);
  }

  @Get(':id/order')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: CustodyOrderHistoryDto, isArray: true, description: 'Order history of the addressed account' })
  async getAccountOrders(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyOrderHistoryDto[]> {
    const ownerAccountId = await this.custodyAccountService.resolveOwnerAccountId(
      this.parseCustodyAccountId(id),
      jwt.account,
    );

    return this.custodyOrderService.getOrdersByUserData(ownerAccountId);
  }

  @Get(':id/pdf')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard(), CustodyAccountReadGuard)
  @ApiOkResponse({ type: PdfDto, description: 'Custody balance PDF report (base64 encoded)' })
  async getAccountPdf(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Query() dto: GetCustodyPdfDto,
  ): Promise<PdfDto> {
    const ownerAccountId = await this.custodyAccountService.resolveOwnerAccountId(
      this.parseCustodyAccountId(id),
      jwt.account,
    );

    const pdfData = await this.custodyPdfService.generateCustodyPdf(ownerAccountId, dto);
    return { pdfData };
  }

  @Get(':id/access')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: [CustodyAccountAccessDto], description: 'List of users with access' })
  async getAccessList(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CustodyAccountAccessDto[]> {
    const accessList = await this.custodyAccountService.getAccessList(
      this.parsePositiveIntParam(id, 'custody account ID'),
      jwt.account,
    );

    return accessList.map(CustodyAccountDtoMapper.toAccessDto);
  }

  @Post(':id/access')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiCreatedResponse({ type: CustodyAccountAccessDto, description: 'Create access grant' })
  async grantAccess(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateCustodyAccountAccessDto,
  ): Promise<CustodyAccountAccessDto> {
    const custodyAccountId = this.parseCustodyAccountId(id);
    const access = await this.custodyAccountService.grantAccess(
      custodyAccountId,
      jwt.account,
      dto.mail,
      dto.accessLevel,
    );

    return CustodyAccountDtoMapper.toAccessDto(access);
  }

  @Put(':id/access/:accessId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ type: CustodyAccountAccessDto, description: 'Update access grant' })
  async updateAccess(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
    @Body() dto: UpdateCustodyAccountAccessDto,
  ): Promise<CustodyAccountAccessDto> {
    const access = await this.custodyAccountService.updateAccess(
      this.parsePositiveIntParam(id, 'custody account ID'),
      this.parsePositiveIntParam(accessId, 'access ID'),
      jwt.account,
      dto.accessLevel,
    );

    return CustodyAccountDtoMapper.toAccessDto(access);
  }

  @Delete(':id/access/:accessId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOkResponse({ description: 'Revoke access grant' })
  async revokeAccess(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
  ): Promise<void> {
    await this.custodyAccountService.revokeAccess(
      this.parsePositiveIntParam(id, 'custody account ID'),
      this.parsePositiveIntParam(accessId, 'access ID'),
      jwt.account,
    );
  }

  private parseCustodyAccountId(id: string): CustodyAccountId {
    if (id === LegacyAccountId) return LegacyAccountId;
    return this.parsePositiveIntParam(id, 'custody account ID');
  }

  /**
   * Finite, safe, positive integer within the Postgres INTEGER/SERIAL range.
   * Rejects non-digits, Infinity (e.g. 309 nines), zero, and values outside column range → 400.
   */
  private parsePositiveIntParam(value: string, name: string): number {
    if (!Util.isDbId(value)) {
      throw new BadRequestException(`Invalid ${name}`);
    }

    return Number(value);
  }
}
