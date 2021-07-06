import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsIBAN, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
export class CreateBuyDto {
    
    @ApiProperty()
    @IsNotEmpty()
    @IsIBAN()
    iban: string;
    
    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    asset: number; // asset should be an object

}