import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { LimitRequestDto } from '../limit-request/dto/limit-request.dto';
import { LimitRequest } from '../limit-request/limit-request.entity';
import { LimitRequestService } from '../limit-request/limit-request.service';
import { IdentUserDataDto } from './dto/ident-user-data.dto';
import { IdentService, KycResult } from './ident.service';
import { IdentUpdateDto } from './dto/ident-update.dto';
import { Config } from 'src/config/config';

@ApiTags('ident')
@Controller('ident')
export class IdentController {
  constructor(private readonly identService: IdentService, private readonly limitRequestService: LimitRequestService) {}

  @Get()
  async getKycProgress(@Query('code') code: string): Promise<KycResult> {
    return await this.identService.getKycProgress(code);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<string> {
    return await this.identService.requestKyc(jwt.id).then(JSON.stringify);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateIdentData(@GetJwt() jwt: JwtPayload, @Body() data: IdentUserDataDto): Promise<boolean> {
    await this.identService.updateIdentData(jwt.id, data);
    return true;
  }

  @Post('limit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async increaseLimit(@GetJwt() jwt: JwtPayload, @Body() request: LimitRequestDto): Promise<LimitRequest> {
    return await this.limitRequestService.increaseLimit(jwt.id, request);
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.identService.uploadDocument(jwt.id, files[0], KycDocument.INCORPORATION_CERTIFICATE);
  }

  // --- ID NOW WEBHOOKS --- //
  @Post('online')
  @ApiExcludeEndpoint()
  async onlineIdWebhook(@RealIP() ip: string, @Body() data: IdentUpdateDto) {
    this.checkWebhookIp(ip, data);
    this.identService.identUpdate(data);
  }

  @Post('video')
  @ApiExcludeEndpoint()
  async videoIdWebhook(@RealIP() ip: string, @Body() data: IdentUpdateDto) {
    this.checkWebhookIp(ip, data);
    this.identService.identUpdate(data);
  }

  private checkWebhookIp(ip: string, data: IdentUpdateDto) {
    if (!Config.kyc.allowedWebhookIps.includes('*') && !Config.kyc.allowedWebhookIps.includes(ip)) {
      console.error(`Received webhook call from invalid IP ${ip}:`, data);
      throw new ForbiddenException('Invalid source IP');
    }
  }
}
