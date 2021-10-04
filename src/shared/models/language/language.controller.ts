import {
    Body,
    Controller,
    Get,
    Param,
    Put,
    UseGuards,
    Post,
    UsePipes,
    ValidationPipe,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
  import { RoleGuard } from 'src/shared/auth/role.guard';
  import { UserRole } from 'src/user/user.entity';
  import { LanguageService } from './language.service';
  import { CreateLanguageDto } from './dto/create-language.dto';
  import { UpdateLanguageDto } from './dto/update-language.dto';
  
  @ApiTags('language')
  @Controller('language')
  export class LanguageController {
    constructor(private readonly languageService: LanguageService) {}
  
    @Get(':key')
    @ApiParam({
      name: 'key',
      required: true,
      description:
        'either an integer for the country id or a string for the language symbol',
      schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    })
    @ApiBearerAuth()
    @UsePipes(ValidationPipe)
    async getLanguage(@Param() language: any): Promise<any> {
      return this.languageService.getLanguage(language);
    }
  
    @Get()
    @ApiBearerAuth()
    async getAllLanguage(): Promise<any> {
      return this.languageService.getAllLanguage();
    }
  
    @Post()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    @UsePipes(ValidationPipe)
    createLanguage(@Body() createLanguageDto: CreateLanguageDto): Promise<any> {
      return this.languageService.createLanguage(createLanguageDto);
    }
  
    @Put()
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    @UsePipes(ValidationPipe)
    async updateLanguage(@Body() language: UpdateLanguageDto) {
      return this.languageService.updateLanguage(language);
    }
  }