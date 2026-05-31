// See: https://bun.com/docs/guides/ecosystem/pm2
module.exports = {
  name: "beatsync-server", // Name of your application
  cwd: "apps/server",
  script: "dist/index.js", // Bundled entry point
  interpreter: "bun", // Bun interpreter
  env: {
    PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
    PORT: "8080", // Can override via: PORT=9090 pm2 start pm2.config.js
    HOST: "0.0.0.0",
  },
};
