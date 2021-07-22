import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, IsNumber, IsIBAN } from "class-validator";

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
    status: string;

    @ApiProperty()
    @IsOptional()
    @IsInt()
    fiat: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    fiatValue: number;

    @ApiProperty()
    @IsOptional()
    @IsInt()
    krypto: number;

    @ApiProperty()
    @IsOptional()
    @IsNumber()
    kryptoValue: number;

    @ApiProperty()
    @IsOptional()
    @IsIBAN()
    iban: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    direction: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    message: string;
}