import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
export class CreateUserDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    address: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    signature: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsEmail()
    mail: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    firstname: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    surname: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    street: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    houseNumber: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    location: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    zip: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    country: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    // TODO: user phonenumber decorator instead of string --> Figure it out
    // @IsPhoneNumber()
    phone: string;
}