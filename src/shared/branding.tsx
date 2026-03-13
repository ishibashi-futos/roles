import type { Child } from "hono/jsx";

type PageShellProps = {
  children: Child;
  title: string;
  bodyClassName?: string;
};

type BrandMarkProps = {
  label: string;
  accentClassName: string;
  textClassName: string;
};

export const PageShell = ({
  children,
  title,
  bodyClassName = "bg-[color:var(--color-ink)] text-slate-50",
}: PageShellProps) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="theme-color" content="#081120" />
      <link rel="icon" type="image/svg+xml" href="/icon.svg" />
      <script src="https://cdn.tailwindcss.com"></script>
      <style>{`
        :root {
          --color-blue: #3b82f6;
          --color-green: #10b981;
          --color-violet: #8b5cf6;
          --color-ink: #081120;
          --color-surface: #f5f7fb;
        }

        body {
          font-family: "Hiragino Sans", "Noto Sans JP", sans-serif;
        }
      `}</style>
    </head>
    <body class={bodyClassName}>{children}</body>
  </html>
);

export const BrandMark = ({
  label,
  accentClassName,
  textClassName,
}: BrandMarkProps) => (
  <div class="flex items-center gap-3">
    <img src="/icon.svg" alt="roles ロゴ" class="h-10 w-10 rounded-2xl" />
    <div>
      <p class={`text-xs uppercase tracking-[0.28em] ${accentClassName}`}>
        {label}
      </p>
      <p class={`text-sm font-medium ${textClassName}`}>multi-agent workflow</p>
    </div>
  </div>
);
