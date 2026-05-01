// Shared error-message extractor. Used everywhere we catch an error of
// type `unknown` (TS strict mode in strictNullChecks-aware catch) and
// need a printable string. Centralized so we don't drift on the
// "instanceof Error" / String() fallback contract.
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
