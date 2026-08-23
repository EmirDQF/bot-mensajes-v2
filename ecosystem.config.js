export default {
  apps: [
    {
      name: 'botmensajes',
      script: './index.js',
      exec_mode: 'cluster',
      instances: 'max',
      env_production: {
        NODE_ENV: 'production',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GEMINI_MODEL: process.env.GEMINI_MODEL,
        ADMIN_WHATSAPP_NUMBER: process.env.ADMIN_WHATSAPP_NUMBER,
        PORT: process.env.PORT,
      },
      max_memory_restart: '300M',
      autorestart: true,
      watch: false,
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
