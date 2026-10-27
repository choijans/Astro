import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AppThrottlerGuard } from '../common/app-throttler.guard';
import { UserId } from '../common/user-id.decorator';
import { UserIdGuard } from '../common/user-id.guard';
import { toCommandResponse } from '../commands/commands.types';
import { CreateFavouriteDto } from './dto/create-favourite.dto';
import { FavouritesService } from './favourites.service';

@Controller('favourites')
@UseGuards(UserIdGuard)
export class FavouritesController {
  constructor(private readonly favouritesService: FavouritesService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.favouritesService.list(userId);
  }

  @Post()
  @HttpCode(202)
  @UseGuards(AppThrottlerGuard)
  async add(
    @Body() dto: CreateFavouriteDto,
    @UserId() userId: string,
    @Headers('x-command-id') commandIdHeader?: string,
  ) {
    const commandId = resolveCommandId(commandIdHeader);
    const command = await this.favouritesService.add(
      userId,
      dto.channelId,
      commandId,
    );
    return toCommandResponse(command);
  }

  @Delete(':channelId')
  @HttpCode(202)
  @UseGuards(AppThrottlerGuard)
  async remove(
    @Param('channelId', ParseIntPipe) channelId: number,
    @UserId() userId: string,
    @Headers('x-command-id') commandIdHeader?: string,
  ) {
    const commandId = resolveCommandId(commandIdHeader);
    const command = await this.favouritesService.remove(
      userId,
      channelId,
      commandId,
    );
    return toCommandResponse(command);
  }
}

function resolveCommandId(header: string | undefined): string {
  if (!header) {
    return randomUUID();
  }
  if (!isUUID(header)) {
    throw new BadRequestException('X-Command-Id header must be a valid UUID');
  }
  return header;
}
