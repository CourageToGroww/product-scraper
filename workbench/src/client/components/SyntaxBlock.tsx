import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const theme: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark as any)['pre[class*="language-"]'],
    background: "var(--color-surface)",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    fontSize: "0.75rem",
    lineHeight: "1.6",
    margin: 0,
    padding: "0.75rem"
  },
  'code[class*="language-"]': {
    ...(oneDark as any)['code[class*="language-"]'],
    background: "none",
    fontSize: "0.75rem"
  }
};

export default function SyntaxBlock({
  code,
  language = "json",
  maxHeight
}: {
  code: string;
  language?: string;
  maxHeight?: string;
}) {
  return (
    <div style={{ maxHeight, overflow: maxHeight ? "auto" : undefined }}>
      <SyntaxHighlighter language={language} style={theme} wrapLongLines>
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
