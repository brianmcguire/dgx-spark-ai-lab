export function doctorScanSummary(scan, exitCode) {
  if (!scan) return { findings: [], incomplete: false, actionableCount: 0, ok: false, clean: false, label: "Not run" };
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const incomplete = exitCode === 3 || (scan.collector_statuses || []).some((status) => status.ok === false);
  const actionableCount = findings.filter((finding) => finding.severity === "warning" || finding.severity === "critical").length;
  const ok = !incomplete && actionableCount === 0;
  return {
    findings,
    incomplete,
    actionableCount,
    ok,
    clean: ok && findings.length === 0,
    label: incomplete ? "Incomplete" : actionableCount ? `${actionableCount} findings` : findings.length ? `${findings.length} info` : "Clean",
  };
}
