export type ServiceMode = 'ReadOnly' | 'Write';

export type ServiceConfiguration = {
  readonly endpoint: string;
  readonly retryLimit: number;
  readonly mode: ServiceMode;
};

export type ConfigurationIssue = {
  readonly code: 'missing' | 'invalid-uri' | 'invalid-range' | 'invalid-mode' | 'invalid-input';
  readonly key: string;
};

export type ConfigurationLoad =
  | { readonly kind: 'ConfigurationLoaded'; readonly value: ServiceConfiguration }
  | { readonly kind: 'ConfigurationRejected'; readonly issues: readonly ConfigurationIssue[] };

const readOwnString = (
  bag: object,
  key: string
): { readonly kind: 'present'; readonly value: string } | { readonly kind: 'absent' } | { readonly kind: 'invalid' } => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(bag, key);
    if (!descriptor) return { kind: 'absent' };
    if (!('value' in descriptor) || typeof descriptor.value !== 'string') return { kind: 'invalid' };
    return { kind: 'present', value: descriptor.value };
  } catch {
    return { kind: 'invalid' };
  }
};

export const loadConfiguration = (raw: unknown): ConfigurationLoad => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return Object.freeze({
      kind: 'ConfigurationRejected',
      issues: Object.freeze([Object.freeze({ code: 'invalid-input', key: 'root' })])
    });
  }
  const issues: ConfigurationIssue[] = [];

  let endpoint = '';
  const endpointRaw = readOwnString(raw, 'Service:Endpoint');
  if (endpointRaw.kind === 'absent') {
    issues.push(Object.freeze({ code: 'missing', key: 'Service:Endpoint' }));
  } else if (endpointRaw.kind === 'invalid') {
    issues.push(Object.freeze({ code: 'invalid-uri', key: 'Service:Endpoint' }));
  } else {
    const trimmed = endpointRaw.value.trim();
    const isHttps = trimmed.startsWith('https://');
    const isHttp = trimmed.startsWith('http://');
    const authority = isHttps ? trimmed.slice(8) : isHttp ? trimmed.slice(7) : '';
    if ((!isHttps && !isHttp) || authority.length === 0 || authority.startsWith('/')) {
      issues.push(Object.freeze({ code: 'invalid-uri', key: 'Service:Endpoint' }));
    } else {
      endpoint = authority.includes('/') ? trimmed : `${trimmed}/`;
    }
  }

  let retryLimit = 0;
  const limitRaw = readOwnString(raw, 'Service:RetryLimit');
  if (limitRaw.kind === 'absent') {
    issues.push(Object.freeze({ code: 'missing', key: 'Service:RetryLimit' }));
  } else if (limitRaw.kind === 'invalid' || !/^-?\d+$/.test(limitRaw.value.trim())) {
    issues.push(Object.freeze({ code: 'invalid-range', key: 'Service:RetryLimit' }));
  } else {
    const parsed = Number(limitRaw.value.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10) {
      issues.push(Object.freeze({ code: 'invalid-range', key: 'Service:RetryLimit' }));
    } else {
      retryLimit = parsed;
    }
  }

  let mode: ServiceMode = 'ReadOnly';
  const modeRaw = readOwnString(raw, 'Service:Mode');
  if (modeRaw.kind === 'absent') {
    issues.push(Object.freeze({ code: 'missing', key: 'Service:Mode' }));
  } else if (modeRaw.kind === 'present' && modeRaw.value === 'read-only') {
    mode = 'ReadOnly';
  } else if (modeRaw.kind === 'present' && modeRaw.value === 'write') {
    mode = 'Write';
  } else {
    issues.push(Object.freeze({ code: 'invalid-mode', key: 'Service:Mode' }));
  }

  if (issues.length > 0) {
    return Object.freeze({
      kind: 'ConfigurationRejected',
      issues: Object.freeze(issues)
    });
  }
  return Object.freeze({
    kind: 'ConfigurationLoaded',
    value: Object.freeze({ endpoint, retryLimit, mode })
  });
};

export const canonicalConfiguration = (result: ConfigurationLoad): string =>
  result.kind === 'ConfigurationLoaded'
    ? `loaded|${result.value.endpoint}|${result.value.retryLimit}|${result.value.mode}`
    : `rejected|${result.issues.map((issue) => `${issue.code}:${issue.key}`).join(';')}`;
