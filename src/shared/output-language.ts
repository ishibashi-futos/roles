export type OutputLanguage = "en" | "ja";

const DEFAULT_OUTPUT_LANGUAGE: OutputLanguage = "ja";

export const getOutputLanguageFromEnv = (env = process.env): OutputLanguage => {
  const candidate = env.ROLES_OUTPUT_LANGUAGE;

  if (candidate === "en" || candidate === "ja") {
    return candidate;
  }

  return DEFAULT_OUTPUT_LANGUAGE;
};

export const describeOutputLanguage = (language: OutputLanguage) =>
  language === "ja" ? "Japanese" : "English";
