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

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.log(`[roles][INFO][${timestamp()}] ${message}${formatMeta(meta)}`);
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(
      `[roles][ERROR][${timestamp()}] ${message}${formatMeta(meta)}`,
    );
  },
};
