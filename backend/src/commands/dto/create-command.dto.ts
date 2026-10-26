import { IsEnum, IsInt, IsUUID, Min } from 'class-validator';
import { CommandType } from '../../../generated/prisma/client';

export class CreateCommandDto {
  @IsUUID()
  id: string;

  @IsEnum(CommandType)
  type: CommandType;

  @IsInt()
  @Min(1)
  channelId: number;
}
