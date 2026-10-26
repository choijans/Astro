import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  // This app is entirely client-rendered (TanStack Query), so the newer
  // server-side caching/prefetching model isn't needed — left off to avoid
  // its extra requirements (e.g. Suspense boundaries) for no benefit here.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'divign0fdw3sv.cloudfront.net',
      },
    ],
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
