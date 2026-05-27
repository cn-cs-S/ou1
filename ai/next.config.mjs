/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    const backendUrl = process.env.OKX_BACKEND_URL || 'http://127.0.0.1:8787'
    return [
      {
        source: '/backend/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
