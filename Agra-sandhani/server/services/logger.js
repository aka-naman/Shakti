const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const logDir = 'logs';

// Robust local timestamp generator (Matches system clock exactly)
const localTimestamp = () => {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// Custom format for clean reading
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: localTimestamp }),
  winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
);

const transport = new winston.transports.DailyRotateFile({
  filename: path.join(logDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '90d' // Keep logs for 90 days
});

const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    transport,
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            logFormat
        )
    })
  ]
});

// Stream for Morgan to use Winston
logger.stream = {
  write: (message) => logger.info(message.trim())
};

module.exports = logger;
