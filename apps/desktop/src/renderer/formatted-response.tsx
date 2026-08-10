import type { JSX, ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return tokens.filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('__') && token.endsWith('__')) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }
    if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
    if (link !== null) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <span key={index}>{token}</span>;
  });
}

export function FormattedResponse({ text }: { text: string }): JSX.Element {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let codeLanguage = '';

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`}>
        {list.items.map((item, index) => <li key={index}>{inline(item)}</li>)}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((line) => {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence !== null) {
      flushParagraph();
      flushList();
      if (code === null) {
        code = [];
        codeLanguage = fence[1]!.trim();
      } else {
        blocks.push(
          <pre key={`code-${blocks.length}`}>
            <code className={codeLanguage === '' ? undefined : `language-${codeLanguage}`}>
              {code.join('\n')}
            </code>
          </pre>,
        );
        code = null;
        codeLanguage = '';
      }
      return;
    }
    if (code !== null) {
      code.push(line);
      return;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      return;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const Tag = `h${heading[1]!.length}` as keyof JSX.IntrinsicElements;
      blocks.push(<Tag key={`h-${blocks.length}`}>{inline(heading[2]!)}</Tag>);
      return;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (bullet !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const item = (isOrdered ? ordered : bullet)![1]!;
      if (list === null || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(item);
      return;
    }
    flushList();
    paragraph.push(line.trim());
  });

  const remainingCode = code as string[] | null;
  if (remainingCode !== null) {
    blocks.push(<pre key={`code-${blocks.length}`}><code>{remainingCode.join('\n')}</code></pre>);
  }
  flushParagraph();
  flushList();
  return <div className="formatted-response">{blocks}</div>;
}
