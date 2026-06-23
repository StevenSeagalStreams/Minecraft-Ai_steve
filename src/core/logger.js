"use strict";

const fs   = require("fs");
const path = require("path");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLOURS = { debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m" };
const RESET   = "\x1b[0m";

/**
 * Structured logger with:
 *   - Colour-coded console output
 *   - Rotating file log
 *   - JSONL telemetry stream for offline analysis
 */
class Logger {
  constructor(config) {
    this.minLevel     = LEVELS[config.logLevel ?? "info"] ?? 1;
    this.logFile      = config.logFile;
    this.telemetryFile = config.telemetryFile;
    this._ensureDir(this.logFile);
    this._ensureDir(this.telemetryFile);
    this._logStream  = fs.createWriteStream(this.logFile, { flags: "a" });
    this._telStream  = fs.createWriteStream(this.telemetryFile, { flags: "a" });
    this.counters    = { debug: 0, info: 0, warn: 0, error: 0 };
  }

  _ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _write(level, module, message, meta) {
    if (LEVELS[level] < this.minLevel) return;
    this.counters[level]++;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}`;
    const metaStr = meta ? " " + JSON.stringify(meta) : "";
    // Console
    process.stdout.write(`${COLOURS[level]}${line}${metaStr}${RESET}\n`);
    // File
    this._logStream.write(line + metaStr + "\n");
  }

  debug(module, msg, meta)  { this._write("debug", module, msg, meta); }
  info(module, msg, meta)   { this._write("info",  module, msg, meta); }
  warn(module, msg, meta)   { this._write("warn",  module, msg, meta); }
  error(module, msg, meta)  { this._write("error", module, msg, meta); }

  /** Writes a structured telemetry event (JSON Lines). */
  telemetry(event, data) {
    const record = { ts: Date.now(), event, ...data };
    this._telStream.write(JSON.stringify(record) + "\n");
  }

  stats() {
    return { ...this.counters };
  }

  close() {
    this._logStream.end();
    this._telStream.end();
  }
}

module.exports = Logger;
