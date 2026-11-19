/** @file WMS-602: строгая проверка недоверенного scan JSON и адресных advisory exceptions; внешнего I/O нет. */
const { runtimeBase, nodeVersion } = require('./runtime.cjs');
/** Исключения являются source policy: дубликаты, неверная область и просрочка блокируют весь gate.
 * Matching требует точного CVE/package/version/severity/status/OS/base/Node и runtime proof.
 * Никакое исключение не разрешает найденное исправление или новую severity автоматически. */
function validateExceptions(exceptions, now) {
  if (!Array.isArray(exceptions) || !Number.isFinite(now)) throw Error('Invalid exception policy');
  const keys = new Set();
  for (const e of exceptions) {
    if (
      !e ||
      !/^CVE-\d{4}-\d+$/.test(e.id) ||
      typeof e.package !== 'string' ||
      !e.package ||
      typeof e.version !== 'string' ||
      !e.version ||
      e.severity !== 'UNKNOWN' ||
      e.status !== 'affected' ||
      e.os !== 'debian' ||
      e.osVersion !== '13.7' ||
      e.base !== runtimeBase ||
      e.nodeVersion !== nodeVersion ||
      typeof e.reason !== 'string' ||
      e.reason.length < 40 ||
      e.source !== 'https://security-tracker.debian.org/tracker/' + e.id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.expires) ||
      !Number.isFinite(Date.parse(e.expires)) ||
      new Date(e.expires).toISOString().slice(0, 10) !== e.expires ||
      Date.parse(e.expires) <= now
    )
      throw Error('Invalid or expired advisory exception');
    const key = e.id + '/' + e.package;
    if (keys.has(key)) throw Error('Duplicate advisory exception');
    keys.add(key);
  }
}
/** Проверяет недоверенный JSON scanner: пустой/чужой отчёт не доказывает безопасность image.
 * Возвращает findings всех уровней; неизвестная severity требует ручного разбора и блокирует gate.
 * @throws При неполной структуре, чужом image ID или HIGH/CRITICAL/UNKNOWN; непроверенное/истёкшее исключение не применяется. */
function validateReport(report, imageId, { exceptions = [], proof, now = Date.now() } = {}) {
  validateExceptions(exceptions, now);
  if (
    !/^sha256:[a-f0-9]{64}$/.test(imageId) ||
    report?.SchemaVersion !== 2 ||
    report.ArtifactType !== 'container_image' ||
    report.Metadata?.ImageID !== imageId ||
    !Array.isArray(report.Results) ||
    !report.Results.some((result) => result.Class === 'os-pkgs')
  )
    throw Error('Incomplete scan report or different image ID');
  const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 };
  const waived = [];
  const blocking = [];
  for (const result of report.Results) {
    if (!result || typeof result.Target !== 'string' || typeof result.Class !== 'string')
      throw Error('Invalid scan result');
    if (result.Vulnerabilities === undefined) continue;
    if (!Array.isArray(result.Vulnerabilities)) throw Error('Invalid vulnerabilities');
    for (const finding of result.Vulnerabilities) {
      if (
        !finding ||
        typeof finding.VulnerabilityID !== 'string' ||
        typeof finding.PkgName !== 'string' ||
        !Object.hasOwn(counts, finding.Severity)
      )
        throw Error('Invalid vulnerability');
      counts[finding.Severity]++;
      if (['HIGH', 'CRITICAL', 'UNKNOWN'].includes(finding.Severity)) {
        const exception = exceptions.find(
          (e) =>
            result.Class === 'os-pkgs' &&
            result.Type === 'debian' &&
            e.id === finding.VulnerabilityID &&
            e.package === finding.PkgName &&
            e.version === finding.InstalledVersion &&
            e.severity === finding.Severity &&
            e.status === finding.Status &&
            !finding.FixedVersion &&
            report.Metadata.OS?.Family === e.os &&
            report.Metadata.OS?.Name === e.osVersion &&
            proof?.base === e.base &&
            proof?.nodeVersion === e.nodeVersion &&
            proof?.jsOnly === true &&
            proof?.toolingAbsent === true &&
            proof?.sharedOpenSSL === false,
        );
        if (exception)
          waived.push({ id: exception.id, package: exception.package, expires: exception.expires });
        else
          blocking.push({
            id: finding.VulnerabilityID,
            package: finding.PkgName,
            severity: finding.Severity,
          });
      }
    }
  }
  if (blocking.length) throw Error(`Image scan rejected: ${JSON.stringify(counts)}`);
  return { ...counts, waived };
}

module.exports = { validateReport, validateExceptions };
