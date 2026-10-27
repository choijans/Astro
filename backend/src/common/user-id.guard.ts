import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

interface RequestWithUserId extends Request {
  userId?: string;
}

/** Applied to every favourites/commands route: requires a valid X-User-Id header. */
@Injectable()
export class UserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUserId>();
    const userId = request.headers['x-user-id'];

    if (typeof userId !== 'string' || !isUUID(userId)) {
      throw new BadRequestException('X-User-Id header must be a valid UUID');
    }

    request.userId = userId;
    return true;
  }
}
