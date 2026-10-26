import { ReactNode } from 'react';

/** 1 column below 640px, 2 from 640-1023px, 4 at 1024px and up. */
export function ChannelGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
