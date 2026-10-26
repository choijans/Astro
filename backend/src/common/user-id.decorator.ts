import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Reads the user id attached by UserIdGuard. Only valid behind that guard. */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.userId as string;
});
