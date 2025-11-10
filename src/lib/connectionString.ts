export function summarizeConnectionString(value: string) {
  try {
    const parsed = new URL(value);

    return {
      usingConnectionString: true,
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.host,
      hasUserCredentials: Boolean(parsed.username || parsed.password),
      database: parsed.pathname.replace(/^\//, '') || undefined,
    };
  } catch {
    return {
      usingConnectionString: true,
      length: value.length,
      format: 'unparseable',
    };
  }
}
