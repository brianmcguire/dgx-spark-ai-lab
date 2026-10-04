export function doctorScanSummary(scan, exitCode) {
  if (!scan) return { findings: [], incompleteChecks: [], incomplete: false, actionableCount: 0, ok: false, clean: false, label: "Not run" };
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const incompleteChecks = (scan.collector_statuses || []).filter((status) =>
    !status.optional && (status.ok === false || (status.errors || []).length > 0));
  const incomplete = exitCode === 3 || incompleteChecks.length > 0 || findings.some((finding) => finding.rule_id?.startsWith("rule.error."));
  const actionableCount = findings.filter((finding) => finding.severity === "warning" || finding.severity === "critical").length;
  const ok = !incomplete && actionableCount === 0;
  return {
    findings,
    incompleteChecks,
    incomplete,
    actionableCount,
    ok,
    clean: ok && findings.length === 0,
    label: incomplete ? "Incomplete" : actionableCount ? `${actionableCount} findings` : findings.length ? `${findings.length} info` : "Clean",
  };
}
