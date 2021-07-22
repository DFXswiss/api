import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsIBAN, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
export class CreateSellDto {
    
    @IsOptional()
    @IsInt()
    id: number;

    @ApiProperty()
    @IsNotEmpty()
    //@IsIBAN()
    iban: string;
    
    @ApiProperty()
    @IsNotEmpty()
    fiat: any;
    
    @IsNotEmpty()
    @Length(34,34)
    @IsString()
    @IsOptional()
    address: string;

    @IsOptional()
    @IsInt()
    depositId: number;

}