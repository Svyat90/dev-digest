// stdout is the MCP protocol channel: every log line goes to stderr.
export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(stream: { write(chunk: string): unknown } = process.stderr): Logger {
  const write = (level: string, msg: string): void => {
    stream.write(`[devdigest-mcp] ${level} ${msg}\n`);
  };
  return {
    info: (msg) => write('info', msg),
    warn: (msg) => write('warn', msg),
    error: (msg) => write('error', msg),
  };
}
