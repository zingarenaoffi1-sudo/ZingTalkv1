module.exports = {
  apps: [
    {
      name: 'zingtalk',
      script: 'server.js',
      node_args: '--expose-gc --max-old-space-size=384',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
