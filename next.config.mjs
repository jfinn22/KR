/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Domain logic and the job worker are Node-only; keep them out of the edge bundle.
    serverActions: {
      bodySizeLimit: '12mb', // guided photo capture uploads several images at once
    },
  },
  images: {
    // Mock storage serves uploads from a local route handler; real storage uses signed URLs.
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
  eslint: {
    dirs: ['src', 'tests', 'scripts'],
  },
}

export default nextConfig
