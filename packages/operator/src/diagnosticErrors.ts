/**
 * Global error counter for the diagnostic file.
 * Increment-only; never reset during the operator lifetime.
 */
let _errorCount = 0;

export function incrementDiagnosticErrorCount(): void {
  _errorCount++;
}

export function getDiagnosticErrorCount(): number {
  return _errorCount;
}
