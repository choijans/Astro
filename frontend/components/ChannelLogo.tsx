'use client';

import Image from 'next/image';
import { useState } from 'react';

interface ChannelLogoProps {
  src: string;
  alt: string;
  sizes?: string;
}

function LogoFallback() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-10 w-10 text-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M8 19h8M12 15v4" />
    </svg>
  );
}

/** Shared by the card and the details page so the fallback behavior never drifts. */
export function ChannelLogo({ src, alt, sizes }: ChannelLogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LogoFallback />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? '100vw'}
      className="object-contain p-3"
      onError={() => setFailed(true)}
    />
  );
}
