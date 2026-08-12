module.exports = {
  apps: [{
    name: process.env.PM2_APP_NAME || "ai-operations-lab",
    script: "server/index.js",
    cwd: __dirname,
    interpreter: "node",
    env: {
      NODE_ENV: "production",
      DASHBOARD_CONFIG: process.env.DASHBOARD_CONFIG || "config/dashboard.local.json",
    },
  }],
};
