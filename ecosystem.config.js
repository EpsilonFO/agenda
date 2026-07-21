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
      },
    },
  ],
};
