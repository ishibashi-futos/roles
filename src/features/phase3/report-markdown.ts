const REQUIRED_SECTION_TITLES = ["決定事項", "対立意見", "残課題"] as const;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderInline = (value: string) =>
  escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

const normalizeHeadingText = (value: string) =>
  value.trim().replace(/\s+/g, " ");

const splitTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isHeading = (line: string) => /^#{1,6}\s+.+$/.test(line);
const isUnorderedListItem = (line: string) => /^\s*[-*]\s+.+$/.test(line);
const isOrderedListItem = (line: string) => /^\s*\d+\.\s+.+$/.test(line);
const isListItem = (line: string) =>
  isUnorderedListItem(line) || isOrderedListItem(line);
const isTableSeparator = (line: string) =>
  /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
const looksLikeTable = (lines: string[], index: number) =>
  index + 1 < lines.length &&
  (lines[index] ?? "").includes("|") &&
  isTableSeparator(lines[index + 1] ?? "");
const getOrderedListMarker = (line: string) => {
  const match = line.match(/^\s*(\d+)\.\s+.+$/);
  return match ? Number(match[1]) : null;
};

export const getRequiredReportSectionTitles = () => [
  ...REQUIRED_SECTION_TITLES,
];

export const validateReportMarkdown = (markdown: string) => {
  const trimmed = markdown.trim();
  if (trimmed.length === 0) {
    throw new Error("report_markdown_is_empty");
  }

  const headings = trimmed
    .split("\n")
    .map((line) => line.match(/^#\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => normalizeHeadingText(match[1] ?? ""));

  const missingSections = REQUIRED_SECTION_TITLES.filter(
    (title) => !headings.includes(title),
  );

  if (missingSections.length > 0) {
    throw new Error(
      `report_markdown_missing_sections:${missingSections.join(",")}`,
    );
  }
};

export const renderReportHtml = (markdown: string) => {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const parts: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trimEnd();

    if (line.trim().length === 0) {
      continue;
    }

    if (isHeading(line)) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) {
        continue;
      }
      const level = Math.min((match[1] ?? "").length, 6);
      const title = normalizeHeadingText(match[2] ?? "");
      const isRequiredSection = REQUIRED_SECTION_TITLES.includes(
        title as (typeof REQUIRED_SECTION_TITLES)[number],
      );
      const className =
        level === 1 && isRequiredSection
          ? ' class="mt-10 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-2xl font-semibold text-slate-900 first:mt-0"'
          : ' class="mt-8 text-xl font-semibold text-slate-900 first:mt-0"';
      parts.push(`<h${level}${className}>${renderInline(title)}</h${level}>`);
      continue;
    }

    if (looksLikeTable(lines, index)) {
      const headerCells = splitTableRow(lines[index] ?? "");
      index += 2;
      const rowHtml: string[] = [];

      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        const cells = splitTableRow(lines[index] ?? "");
        rowHtml.push(
          `<tr>${cells.map((cell) => `<td class="border border-slate-200 px-3 py-2 align-top">${renderInline(cell)}</td>`).join("")}</tr>`,
        );
        index += 1;
      }

      index -= 1;
      parts.push(
        `<div class="mt-4 overflow-x-auto"><table class="min-w-full border-collapse text-sm text-slate-700"><thead><tr>${headerCells.map((cell) => `<th class="border border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold">${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rowHtml.join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (isListItem(line)) {
      const items: string[] = [];
      const isOrderedList = isOrderedListItem(line);
      const orderedListStart = isOrderedList
        ? getOrderedListMarker(line)
        : null;

      while (
        index < lines.length &&
        (isOrderedList
          ? isOrderedListItem(lines[index] ?? "")
          : isUnorderedListItem(lines[index] ?? ""))
      ) {
        const item = isOrderedList
          ? (lines[index] ?? "").replace(/^\s*\d+\.\s+/, "")
          : (lines[index] ?? "").replace(/^\s*[-*]\s+/, "");
        items.push(`<li>${renderInline(item)}</li>`);
        index += 1;
      }
      index -= 1;
      const tagName = isOrderedList ? "ol" : "ul";
      const startAttribute =
        isOrderedList && orderedListStart && orderedListStart > 1
          ? ` start="${orderedListStart}"`
          : "";
      const listClassName = isOrderedList
        ? "mt-4 list-decimal list-outside space-y-3 pl-8 text-sm leading-7 text-slate-700 marker:font-semibold marker:text-slate-500"
        : "mt-4 list-disc list-outside space-y-3 pl-8 text-sm leading-7 text-slate-700 marker:text-slate-500";
      parts.push(
        `<${tagName}${startAttribute} class="${listClassName}">${items.join("")}</${tagName}>`,
      );
      continue;
    }

    const paragraphLines = [line.trim()];
    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1] ?? "";
      if (
        nextLine.trim().length === 0 ||
        isHeading(nextLine) ||
        isListItem(nextLine) ||
        looksLikeTable(lines, index + 1)
      ) {
        break;
      }
      paragraphLines.push(nextLine.trim());
      index += 1;
    }

    parts.push(
      `<p class="mt-4 text-sm leading-7 text-slate-700">${renderInline(paragraphLines.join(" "))}</p>`,
    );
  }

  return parts.join("");
};
