import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: false, // Disabled — StrictMode double-invokes effects, resetting wake word locks
  env: {
    NEXT_PUBLIC_JARVIS_WS: process.env['NEXT_PUBLIC_JARVIS_WS'] ?? 'ws://localhost:7777/ws',
    NEXT_PUBLIC_JARVIS_API: process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777',
  },
};

export default config;
