const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = /^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|bearer|client[-_]?secret|cookie|password|private[-_]?key|secret|token)$/i;
const SENSITIVE_ASSIGNMENT = /((?:--)?(?:api[-_]?key|access[-_]?token|client[-_]?secret|cookie|password|private[-_]?key|secret|token)(?:\s*[:=]\s*|\s+))("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SENSITIVE_ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PASSWORD|PRIVATE_KEY|SECRET|TOKEN))=([^\s,;]+)/g;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIALS = /(https?:\/\/[^\s/:@]+:)[^\s/@]+@/gi;

export function redactSensitiveString(value) {
  return String(value)
    .replace(SENSITIVE_ASSIGNMENT, `$1${REDACTED}`)
    .replace(SENSITIVE_ENV_ASSIGNMENT, `$1=${REDACTED}`)
    .replace(BEARER_CREDENTIAL, `$1${REDACTED}`)
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`);
}

export function redactSensitiveData(value) {
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? REDACTED : redactSensitiveData(item),
  ]));
}
