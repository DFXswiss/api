import { BadRequestException, Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TransactionType } from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { InvoiceDto } from './dto/invoice.dto';
import { UpdateRefRewardDto } from './dto/update-ref-reward.dto';
import { RefReward } from './ref-reward.entity';
import { RefRewardService } from './services/ref-reward.service';

@ApiTags('reward/ref')
@Controller('reward/ref')
export class RefRewardController {
  constructor(
    private readonly refRewardService: RefRewardService,
    private readonly transactionService: TransactionService,
    private readonly swissQrService: SwissQRService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
  ) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateVolumes(): Promise<void> {
    return this.refRewardService.updateVolumes();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateRefReward(@Param('id') id: string, @Body() dto: UpdateRefRewardDto): Promise<RefReward> {
    return this.refRewardService.updateRefReward(+id, dto);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async createPendingRefRewards(): Promise<void> {
    return this.refRewardService.createPendingRefRewards();
  }

  @Put('/transaction/:id/invoice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserActiveGuard)
  @ApiOkResponse({ type: InvoiceDto })
  async generateInvoiceFromTransaction(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<InvoiceDto> {
    const transaction = await this.transactionService.getTransactionById(+id, {
      user: { userData: true },
      refReward: { user: { userData: true } },
    });

    if (!transaction) throw new BadRequestException('Transaction not found');
    if (!transaction.refReward) throw new BadRequestException('Transaction is not a referral transaction');
    if (!transaction.user.userData.isDataComplete) throw new BadRequestException('User data is not complete');

    const bankInfo = await this.refRewardService.getBankInfo();
    const targetBlockchain = transaction.refReward.targetBlockchain;
    const currency = await this.fiatService.getFiat(transaction.user.userData.currency.id);
    if (!targetBlockchain) throw new BadRequestException('Missing blockchain information');

    const asset = await this.assetService.getNativeAsset(targetBlockchain);

    return {
      invoicePdf: await this.swissQrService.createInvoiceFromTx(
        transaction,
        bankInfo,
        ['CHF', 'EUR'].includes(currency.name) ? (currency.name as 'CHF' | 'EUR') : 'CHF',
        TransactionType.REFERRAL,
      ),
    };
  }
}
