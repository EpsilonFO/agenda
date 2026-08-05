/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Permet à src/instrumentation.ts de démarrer le scheduler des rappels
    // au boot du serveur (voir ce fichier pour le détail).
    instrumentationHook: true,
  },
  webpack: (config) => {
    // transformers.js (Whisper local) : ignorer les modules Node côté navigateur.
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
    };
    return config;
  },
  async headers() {
    return [
      {
        // Empêche le navigateur/OS de garder en cache une vieille version
        // du service worker : sans ça, les mises à jour (surtout en PWA
        // installée sur mobile) peuvent mettre longtemps à être détectées.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
