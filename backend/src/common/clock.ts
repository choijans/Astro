import { Injectable } from '@nestjs/common';

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

/** The real clock, used everywhere outside tests. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
