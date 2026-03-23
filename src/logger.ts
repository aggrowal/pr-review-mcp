import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { performance } from "perf_hooks";

// ---- Log levels ----

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

const MCP_LEVEL_MAP: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "debug",
  [LogLevel.INFO]: "info",
  [LogLevel.WARN]: "warning",
  [LogLevel.ERROR]: "error",
};

// ---- Logger ----

export interface McpServerHandle {
  sendLoggingMessage(params: {
    level: string;
    logger?: string;
    data: unknown;
  }): Promise<void>;
}

export interface LoggerOptions {
  level: LogLevel;
  filePath?: string;
}

export class Logger {
  private level: LogLevel;
  private filePath: string | undefined;
  private mcpServer: McpServerHandle | undefined;
  private fileReady = false;

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.filePath = options.filePath;
    if (this.filePath) {
      try {
        mkdirSync(dirname(this.filePath), { recursive: true });
        this.fileReady = true;
      } catch {
        console.error(`[pr-review-mcp] Failed to create log directory for ${this.filePath}`);
      }
    }
  }

  setMcpServer(server: McpServerHandle): void {
    this.mcpServer = server;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Returns a function that, when called, logs the step completion with elapsed time.
   * Logs step entry at DEBUG and completion at INFO.
   */
  startStep(label: string): (extra?: Record<string, unknown>) => void {
    this.debug(`${label} -- starting`);
    const start = performance.now();
    return (extra?: Record<string, unknown>) => {
      const ms = Math.round(performance.now() - start);
      this.info(`${label} [${ms}ms]`, extra);
    };
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (level < this.level) return;

    const timestamp = new Date().toISOString();
    const tag = LEVEL_LABELS[level];
    const line = data && level === LogLevel.DEBUG
      ? `[${timestamp}] [${tag}] ${message} ${JSON.stringify(data)}`
      : `[${timestamp}] [${tag}] ${message}`;

    this.writeStderr(line);
    this.writeFile(line);
    this.writeMcp(level, message, data);
  }

  private writeStderr(line: string): void {
    console.error(line);
  }

  private writeFile(line: string): void {
    if (!this.filePath || !this.fileReady) return;
    try {
      appendFileSync(this.filePath, line + "\n", "utf-8");
    } catch {
      // File write failure should never crash the server
    }
  }

  private writeMcp(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.mcpServer) return;
    const mcpLevel = MCP_LEVEL_MAP[level];
    const payload = data ? `${message} | ${JSON.stringify(data)}` : message;
    this.mcpServer
      .sendLoggingMessage({ level: mcpLevel, logger: "pr-review-mcp", data: payload })
      .catch(() => {
        // MCP notification failure is non-fatal
      });
  }
}

// ---- Config resolution ----

const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);

function parseLevel(raw: string | undefined): LogLevel | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (!VALID_LEVELS.has(lower)) return undefined;
  const map: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
  };
  return map[lower];
}

export interface LogConfigSources {
  cliLogLevel?: string;
  cliLogFile?: string;
  envLogLevel?: string;
  configLogLevel?: string;
  configLogFile?: boolean | string;
}

export interface ResolvedLogConfig {
  level: LogLevel;
  filePath: string | undefined;
}

export function resolveLogConfig(sources: LogConfigSources): ResolvedLogConfig {
  const level =
    parseLevel(sources.cliLogLevel) ??
    parseLevel(sources.envLogLevel) ??
    parseLevel(sources.configLogLevel) ??
    LogLevel.INFO;

  let filePath: string | undefined;
  if (sources.cliLogFile !== undefined) {
    filePath = sources.cliLogFile;
  } else if (sources.configLogFile === true) {
    filePath = defaultLogFilePath();
  } else if (typeof sources.configLogFile === "string") {
    filePath = sources.configLogFile;
  }

  return { level, filePath };
}

export function defaultLogFilePath(): string {
  const { homedir } = require("os") as typeof import("os");
  const { join } = require("path") as typeof import("path");
  return join(homedir(), ".pr-review-mcp", "debug.log");
}

// ---- CLI arg parsing ----

export function parseCliArgs(argv: string[]): { logLevel?: string; logFile?: string } {
  const args = argv.slice(2);
  let logLevel: string | undefined;
  let logFile: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--log-level=")) {
      logLevel = arg.slice("--log-level=".length);
    } else if (arg.startsWith("--log-file=")) {
      logFile = arg.slice("--log-file=".length);
    } else if (arg === "--log-file") {
      logFile = defaultLogFilePath();
    }
  }

  return { logLevel, logFile };
}

// ---- Null logger for tests ----

export function createNullLogger(): Logger {
  return new Logger({ level: LogLevel.ERROR + 1 as LogLevel });
}
