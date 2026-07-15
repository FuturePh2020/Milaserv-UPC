import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  // Minimum length is enforced dynamically from env (PASSWORD_MIN_LENGTH)
  // in AuthService; this is only a floor.
  @IsString()
  @MinLength(8)
  newPassword: string;
}
