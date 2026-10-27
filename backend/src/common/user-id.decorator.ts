import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

interface RequestWithUserId extends Request {
  userId: string;
}

/** Reads the user id attached by UserIdGuard. Only valid behind that guard. */
export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUserId>();
    return request.userId;
  },
);
