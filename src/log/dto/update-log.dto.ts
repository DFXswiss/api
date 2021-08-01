import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, IsNumber, IsIBAN } from "class-validator";
import { LogDirection, LogStatus } from "../log.entity";

export class UpdateLogDto {

    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    id: number;

    @ApiProperty()
    @IsOptional()
    @Length(34,34)
    @IsString()
    address: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    type: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    status: LogStatus;

    @ApiProperty()
    @IsOptional()
    fiat: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    fiatValue: number;

    @ApiProperty()
    @IsOptional()
    asset: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    assetValue: number;

    @ApiProperty()
    @IsOptional()
    @IsIBAN()
    iban: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    direction: LogDirection;

    @ApiProperty()
    @IsOptional()
    @IsString()
    message: string;
}