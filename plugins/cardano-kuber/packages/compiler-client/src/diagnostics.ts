/** A compiler diagnostic normalized for MCP and other framework adapters. */
export interface CompilerDiagnostic {
  message: string;
  severity: "error" | "warning";
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

const BRACKETED_LOCATION = /\[([^\]\n]+):(\d+):(\d+)\]/;
const PLAIN_LOCATION =
  /(?:^|\n)\s*(\.?\.?\/[^:\n]+|[^\s:\n]+\.(?:ak|hs|toml)):(\d+):(\d+)(?::|\s|$)/;

/**
 * Extract the first source location supported by the Aiken/GHC log formats.
 * The complete compiler log remains in the message so no useful context is lost.
 */
export function diagnosticsFromLog(log: string, code?: string): CompilerDiagnostic[] {
  const message = log.trim();
  if (message === "") {
    return [
      {
        message: "The compiler returned no diagnostics.",
        severity: "error",
        ...(code ? { code } : {}),
      },
    ];
  }

  const match = BRACKETED_LOCATION.exec(log) ?? PLAIN_LOCATION.exec(log);
  if (!match) return [{ message, severity: "error", ...(code ? { code } : {}) }];

  const [, file, line, column] = match;
  return [
    {
      message,
      severity: "error",
      ...(file ? { file } : {}),
      ...(line ? { line: Number(line) } : {}),
      ...(column ? { column: Number(column) } : {}),
      ...(code ? { code } : {}),
    },
  ];
}
