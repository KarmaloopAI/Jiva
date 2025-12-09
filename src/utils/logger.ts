import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS'
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  debug(message: string, ...args: any[]) {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: any[]) {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, error?: Error | unknown, ...args: any[]) {
    this.log(LogLevel.ERROR, message, ...args);
    if (error instanceof Error) {
      console.error(chalk.red(error.stack || error.message));
    } else if (error) {
      console.error(chalk.red(JSON.stringify(error, null, 2)));
    }
  }

  success(message: string, ...args: any[]) {
    this.log(LogLevel.SUCCESS, message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    const levelOrder = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.SUCCESS];
    const currentLevelIndex = levelOrder.indexOf(this.logLevel);
    const messageLevelIndex = levelOrder.indexOf(level);

    if (messageLevelIndex < currentLevelIndex && level !== LogLevel.SUCCESS) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = this.getPrefix(level);
    const formattedMessage = `${chalk.gray(timestamp)} ${prefix} ${message}`;

    console.log(formattedMessage, ...args);
  }

  private getPrefix(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return chalk.gray('[DEBUG]');
      case LogLevel.INFO:
        return chalk.blue('[INFO]');
      case LogLevel.WARN:
        return chalk.yellow('[WARN]');
      case LogLevel.ERROR:
        return chalk.red('[ERROR]');
      case LogLevel.SUCCESS:
        return chalk.green('[SUCCESS]');
      default:
        return '';
    }
  }
}

export const logger = Logger.getInstance();
