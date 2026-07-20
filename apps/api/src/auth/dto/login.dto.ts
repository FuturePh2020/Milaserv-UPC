import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class LoginDto {
  @ApiProperty()
  @IsString()
  @Length(3, 64)
  username!: string;

  @ApiProperty()
  @IsString()
  @Length(8, 128)
  password!: string;
}
