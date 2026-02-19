/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phaser needs to be handled as a client-side only library; Rapier3d uses WebAssembly
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // Tell webpack the client environment supports async/await (for Rapier WASM loader)
    if (!isServer) {
      config.output.environment = {
        ...config.output.environment,
        asyncFunction: true,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
