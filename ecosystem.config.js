module.exports = {
  apps: [
    {
      name: "agenda",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/home/ubuntu/agenda",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        // Les événements sont stockés en heure locale sans fuseau : le process
        // doit tourner en heure de Paris, quel que soit le fuseau du VPS.
        TZ: "Europe/Paris",
      },
    },
  ],
};
