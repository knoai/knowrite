/**
 * 日志流收集器
 * 拦截 console.log/warn/error，通过 SSE 实时推送给前端
 */

const MAX_LOGS = 500;

class LogStream {
  constructor() {
    this.buffer = [];
    this.subscribers = new Set();
    this.intercepted = false;
  }

  add(level, args) {
    const message = formatArgs(args);
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_LOGS) {
      this.buffer.shift();
    }
    this.subscribers.forEach((cb) => cb(entry));
  }

  getHistory() {
    return this.buffer;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  unsubscribe(callback) {
    this.subscribers.delete(callback);
  }

  interceptConsole() {
    if (this.intercepted) return;
    this.intercepted = true;

    const originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };

    console.log = (...args) => {
      originals.log.apply(console, args);
      this.add('log', args);
    };

    console.warn = (...args) => {
      originals.warn.apply(console, args);
      this.add('warn', args);
    };

    console.error = (...args) => {
      originals.error.apply(console, args);
      this.add('error', args);
    };
  }
}

function formatArgs(args) {
  if (args.length === 0) return '';
  const first = args[0];
  if (typeof first === 'string' && args.length > 1) {
    // 简单处理 %s %d %j 等占位符
    let idx = 1;
    const formatted = first.replace(/%[sdjifoO%]/g, (match) => {
      if (match === '%%') return '%';
      if (idx >= args.length) return match;
      const val = args[idx++];
      if (match === '%s') return String(val);
      if (match === '%d' || match === '%i' || match === '%f') return Number(val);
      if (match === '%j') return JSON.stringify(val);
      if (match === '%o' || match === '%O') return inspect(val);
      return String(val);
    });
    const rest = args.slice(idx).map((a) => inspect(a)).join(' ');
    return rest ? `${formatted} ${rest}` : formatted;
  }
  return args.map((a) => inspect(a)).join(' ');
}

function inspect(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const str = JSON.stringify(value);
    if (str.length > 500) return str.slice(0, 500) + '...';
    return str;
  } catch {
    return String(value);
  }
}

const logStream = new LogStream();

module.exports = logStream;
