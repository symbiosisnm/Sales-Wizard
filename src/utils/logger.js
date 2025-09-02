(function (root, factory) {
  const logger = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = logger;
  }
  root.logger = logger;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const env = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) || 'development';
  const defaultLevel = env === 'production' ? 'info' : 'debug';
  const levelName = (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) || defaultLevel;
  const currentLevel = levels[levelName] !== undefined ? levelName : defaultLevel;
  let logStream = null;
  if (typeof process !== 'undefined' && process.versions && process.versions.node && process.env && process.env.LOG_FILE) {
    try {
      const fs = require('fs');
      logStream = fs.createWriteStream(process.env.LOG_FILE, { flags: 'a' });
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('Failed to initialize log file:', err);
      }
    }
  }
  function write(level, args) {
    if (levels[level] < levels[currentLevel]) return;
    const ts = new Date().toISOString();
    if (typeof console !== 'undefined' && console[level === 'debug' ? 'log' : level]) {
      console[level === 'debug' ? 'log' : level](...args);
    }
    if (logStream) {
      const line = `[${ts}] [${level.toUpperCase()}] ` + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
      logStream.write(line);
    }
  }
  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args)
  };
});
