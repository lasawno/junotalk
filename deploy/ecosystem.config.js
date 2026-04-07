// JunoTalk — PM2 process manager configuration
// Install PM2: npm install -g pm2
// Start:   pm2 start deploy/ecosystem.config.js
// Save:    pm2 save
// Boot:    pm2 startup  (then run the command it prints)

module.exports = {
  apps: [
    {
      name: "junotalk",
      script: "dist/index.cjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",

      // Restart policy
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "1G",

      // Environment — copy your .env values here or use a .env file
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,

        // Database
        DATABASE_URL: "REPLACE_WITH_SUPABASE_URL",

        // Session
        SESSION_SECRET: "REPLACE_WITH_STRONG_SECRET",
        ENCRYPTION_KEY: "REPLACE_WITH_ENCRYPTION_KEY",

        // Redis (Upstash or self-hosted)
        REDIS_URL: "REPLACE_WITH_REDIS_URL",

        // AI integrations
        AI_INTEGRATIONS_OPENAI_API_KEY: "REPLACE_IF_USING_OPENAI",
        AI_INTEGRATIONS_ANTHROPIC_API_KEY: "REPLACE_IF_USING_ANTHROPIC",
        AI_INTEGRATIONS_OPENROUTER_API_KEY: "REPLACE_IF_USING_OPENROUTER",
        MOONSHOT_API_KEY: "REPLACE_WITH_KIMI_KEY",

        // TURN server (self-hosted coturn)
        TURN_SERVER_URL: "turn:YOUR_DOMAIN:3478",
        TURN_SERVER_SECRET: "REPLACE_WITH_COTURN_SECRET",

        // Piper TTS (separate port from Whisper)
        PIPER_TTS_PORT: "5097",
        WHISPER_SIDECAR_PORT: "5099",
      },

      // Logs
      out_file: "/var/log/junotalk/app.log",
      error_file: "/var/log/junotalk/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
