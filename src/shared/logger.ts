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

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    if (isTestRuntime()) {
      return;
    }
    console.log(`[roles][INFO][${timestamp()}] ${message}${formatMeta(meta)}`);
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (isTestRuntime()) {
      return;
    }
    console.error(
      `[roles][ERROR][${timestamp()}] ${message}${formatMeta(meta)}`,
    );
  },
};
