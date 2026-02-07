/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    rules: {
      '*.tsx': {
        loaders: [
          { loader: '@locator/webpack-loader', options: { env: 'development' } },
        ],
      },
      '*.ts': {
        loaders: [
          { loader: '@locator/webpack-loader', options: { env: 'development' } },
        ],
      },
    },
  },
  assetPrefix: '/v0',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
