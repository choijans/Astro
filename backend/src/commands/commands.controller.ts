import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { UserId } from '../common/user-id.decorator';
import { UserIdGuard } from '../common/user-id.guard';
import { CommandsService } from './commands.service';
import { toCommandResponse } from './commands.types';
import { CreateCommandDto } from './dto/create-command.dto';

@Controller('commands')
@UseGuards(UserIdGuard)
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  @Post()
  @HttpCode(202)
  async create(@Body() dto: CreateCommandDto, @UserId() userId: string) {
    const command = await this.commandsService.enqueue({
      id: dto.id,
      userId,
      type: dto.type,
      channelId: dto.channelId,
    });
    return toCommandResponse(command);
  }

  @Get(':id')
  async getStatus(@Param('id', new ParseUUIDPipe()) id: string, @UserId() userId: string) {
    const command = await this.commandsService.getStatus(id, userId);
    return toCommandResponse(command);
  }
}
