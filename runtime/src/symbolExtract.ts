// Lightweight, dependency-free symbol extraction. Regex-based per language
// family — deliberately not a full parser (no native Tree-sitter dep), but
// enough to index top-level declarations for fast symbol lookup. Pure and
// unit-testable.

export type ExtractedSymbol = {
  kind: string; // function | method | class | struct | interface | enum | type | trait | protocol | const
  name: string;
  line: number; // 1-based
};

type Pattern = { kind: string; regex: RegExp; nameGroup: number };

// Patterns are applied per line; the first pattern that matches wins so a
// line is attributed to at most one symbol.
const patternsByLanguage: Record<string, Pattern[]> = {
  TypeScript: tsJsPatterns(),
  JavaScript: tsJsPatterns(),
  Swift: [
    { kind: "func", regex: /^\s*(?:public|private|internal|fileprivate|open|static|final|override|\s)*func\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "class", regex: /^\s*(?:public|private|internal|fileprivate|open|final|\s)*class\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "struct", regex: /^\s*(?:public|private|internal|fileprivate|\s)*struct\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "enum", regex: /^\s*(?:public|private|internal|fileprivate|\s)*enum\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "protocol", regex: /^\s*(?:public|private|internal|\s)*protocol\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "extension", regex: /^\s*(?:public|private|internal|\s)*extension\s+([A-Za-z_]\w*)/, nameGroup: 1 }
  ],
  Python: [
    { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "function", regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, nameGroup: 1 }
  ],
  Go: [
    { kind: "func", regex: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "type", regex: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, nameGroup: 1 }
  ],
  Rust: [
    { kind: "function", regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "struct", regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "enum", regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "trait", regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/, nameGroup: 1 }
  ],
  Java: javaLikePatterns(),
  "C#": javaLikePatterns(),
  Kotlin: [
    { kind: "class", regex: /^\s*(?:public|private|internal|open|abstract|final|data|\s)*class\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "interface", regex: /^\s*(?:public|private|internal|\s)*interface\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "function", regex: /^\s*(?:public|private|internal|open|override|suspend|\s)*fun\s+([A-Za-z_]\w*)/, nameGroup: 1 }
  ],
  Ruby: [
    { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "module", regex: /^\s*module\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "function", regex: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/, nameGroup: 1 }
  ]
};

function tsJsPatterns(): Pattern[] {
  return [
    { kind: "class", regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, nameGroup: 1 },
    { kind: "enum", regex: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, nameGroup: 1 },
    { kind: "const", regex: /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, nameGroup: 1 }
  ];
}

function javaLikePatterns(): Pattern[] {
  return [
    { kind: "class", regex: /^\s*(?:public|private|protected|abstract|final|static|\s)*class\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "interface", regex: /^\s*(?:public|private|protected|\s)*interface\s+([A-Za-z_]\w*)/, nameGroup: 1 },
    { kind: "enum", regex: /^\s*(?:public|private|protected|\s)*enum\s+([A-Za-z_]\w*)/, nameGroup: 1 }
  ];
}

const maxSymbolsPerFile = 2000;

/**
 * Extract top-level-ish symbols from a file's content. Returns at most
 * maxSymbolsPerFile entries. Unknown languages yield an empty list.
 */
export function extractSymbols(language: string, content: string): ExtractedSymbol[] {
  const patterns = patternsByLanguage[language];
  if (!patterns || content.length === 0) {
    return [];
  }
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (symbols.length >= maxSymbolsPerFile) {
      break;
    }
    const line = lines[i];
    // Skip obvious comment lines cheaply.
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
      continue;
    }
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (match && match[pattern.nameGroup]) {
        symbols.push({ kind: pattern.kind, name: match[pattern.nameGroup], line: i + 1 });
        break;
      }
    }
  }
  return symbols;
}
