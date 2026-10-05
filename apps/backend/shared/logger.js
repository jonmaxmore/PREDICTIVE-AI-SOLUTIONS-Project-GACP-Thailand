// Logger utilities using Winston
const winston = require('winston');

const createLogger = module => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { service: module },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
    ],
  });
};

const defaultLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'gacp-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

// Stream object for morgan middleware
defaultLogger.stream = {
  write: (message) => {
    defaultLogger.info(message.trim());
  },
};

module.exports = defaultLogger;
module.exports.createLogger = createLogger;

