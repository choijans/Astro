import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

/** Applied to every favourites/commands route: requires a valid X-User-Id header. */
@Injectable()
export class UserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-user-id'];

    if (typeof userId !== 'string' || !isUUID(userId)) {
      throw new BadRequestException('X-User-Id header must be a valid UUID');
    }

    request.userId = userId;
    return true;
  }
}
