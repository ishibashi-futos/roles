const formatMeta = (meta?: Record<string, unknown>) => {
  if (!meta) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' {"meta":"unserializable"}';
  }
};

const timestamp = () => new Date().toISOString();

const isTestRuntime = () => {
  const runtime = globalThis as typeof globalThis & {
    expect?: unknown;
    test?: unknown;
  };

  return (
    typeof runtime.expect === "function" && typeof runtime.test === "function"
  );
};

const isSuppressed = () => process.env.ROLES_SUPPRESS_LOGS === "1";

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    if (isTestRuntime() || isSuppressed()) {
      return;
    }
    console.log(`[roles][INFO][${timestamp()}] ${message}${formatMeta(meta)}`);
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (isTestRuntime() || isSuppressed()) {
      return;
    }
    console.error(
      `[roles][ERROR][${timestamp()}] ${message}${formatMeta(meta)}`,
    );
  },
};
