import { execSync } from 'child_process';

const getGitSha = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
};

const isExport = process.env.NEXT_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
  },
  ...(isExport && { output: 'export', assetPrefix: './' }),
}

export default nextConfig
