/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix: '/v0',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
