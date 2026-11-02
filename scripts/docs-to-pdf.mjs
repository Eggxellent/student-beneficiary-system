#!/usr/bin/env node
/**
 * Renders docs/final-documentation-content/*.md to PDF.
 *
 * No third-party dependency: a small CommonMark-subset renderer produces styled HTML,
 * and headless Chrome (already installed) prints it to A4 PDF.
 *
 *   node scripts/docs-to-pdf.mjs                  # combined PDF + the three chapter drafts
 *   node scripts/docs-to-pdf.mjs --combined       # combined PDF only
 *   node scripts/docs-to-pdf.mjs --all            # one PDF for every file (28 files)
 *   node scripts/docs-to-pdf.mjs --only=CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md
 *
 * The default is deliberately small: the combined package already contains every document,
 * so a per-file PDF for it would be a second copy. Only the chapters are also kept apart,
 * because those are the files that get printed, annotated and submitted on their own.
 * A full per-file run prunes any PDF the current run did not produce.
 *
 * Output: docs/final-documentation-content/pdf/
 * The HTML used for printing is written to the OS temp directory, never to the repo.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DIR = path.join(process.cwd(), 'docs', 'final-documentation-content');
const OUT_DIR = path.join(SRC_DIR, 'pdf');
const COMBINED_NAME = 'SBMS_CHAPTERS_4_5_6_DOCUMENTATION_PACKAGE.pdf';
const EVIDENCE_REVISION = 'd6b5032';
const BRANCH = 'fix/sbms-completion-work';

// Reading order from CLAUDE_HANDOFF_GUIDE.md §1, entry set first, deep catalogues after.
const ORDER = [
  'CLAUDE_HANDOFF_GUIDE.md',
  'ACADEMIC_GUIDE_REQUIREMENTS.md',
  'SBMS_EVIDENCE_PROVENANCE_AND_CLAIM_LIMITS.md',
  'CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN_EVIDENCE.md',
  'CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION_EVIDENCE.md',
  'CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORK_EVIDENCE.md',
  'MASTER_EVIDENCE_REGISTER.md',
  'CROSS_CHAPTER_CONSISTENCY_AND_TRACEABILITY.md',
  'DIAGRAM_SPECIFICATIONS.md',
  'FIGURE_PLACEHOLDER_CHECKLIST.md',
  'ACADEMIC_COMPLETENESS_AND_GAP_AUDIT.md',
  'DOCUMENTATION_GAP_REGISTER.md',
  'CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md',
  'CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md',
  'CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md',
  'SBMS_REQUIREMENTS_AND_SCOPE_CATALOGUE.md',
  'SBMS_SYSTEM_ARCHITECTURE_AND_MODULE_MAP.md',
  'SBMS_DATABASE_SCHEMA_AND_DATA_DICTIONARY.md',
  'SBMS_API_ENDPOINT_CATALOGUE.md',
  'SBMS_SECURITY_AND_ACCESS_CONTROL_CATALOGUE.md',
  'SBMS_ML_SUBSYSTEM_DOCUMENTATION.md',
  'SBMS_UI_SCREEN_AND_WORKFLOW_INVENTORY.md',
  'SBMS_TEST_EVIDENCE_CATALOGUE.md',
  'SBMS_DEPLOYMENT_AND_OPERATIONS_GUIDE.md',
  'EVIDENCE_AND_VERIFICATION_REPORT.md',
  'OBJECTIVE_REQUIREMENT_TEST_TRACEABILITY.md',
  'SBMS_COMPREHENSIVE_CHAPTERS_4_5_6_INFORMATION_REPORT.md',
];

// Standalone PDFs kept in addition to the combined package: the three chapters, because those
// are read, annotated and printed separately from the evidence set they are built on.
const DELIVERABLES = [
  'CHAPTER_4_SYSTEM_ANALYSIS_AND_DESIGN.md',
  'CHAPTER_5_IMPLEMENTATION_TESTING_AND_EVALUATION.md',
  'CHAPTER_6_CONCLUSIONS_RECOMMENDATIONS_AND_FUTURE_WORKS.md',
];

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

/* ------------------------------------------------------------------ inline */

const PLACEHOLDER_PIPE = '\u0000P\u0000';

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text) {
  const codes = [];
  let s = text.replace(/(`+)([\s\S]*?)\1/g, (_match, _fence, body) => {
    // Escaped pipes and angle brackets are literal inside code spans.
    codes.push(body.replace(/\\\|/g, '|').replace(/^\s+|\s+$/g, ''));
    return `\u0000C${codes.length - 1}\u0000`;
  });
  s = s.replace(/\\\|/g, PLACEHOLDER_PIPE);
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s([>])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(new RegExp(PLACEHOLDER_PIPE, 'g'), '|');
  s = s.replace(/\u0000C(\d+)\u0000/g, (_match, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
  return s;
}

/* ------------------------------------------------------------------ blocks */

function isTableSeparator(line) {
  return /^\s*\|/.test(line) && /-/.test(line) && /^\s*\|[\s:|-]*$/.test(line);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < s.length; i += 1) {
    const char = s[i];
    if (char === '\\' && s[i + 1] === '|') {
      current += '\\|';
      i += 1;
      continue;
    }
    if (char === '`') {
      inCode = !inCode;
      current += char;
      continue;
    }
    if (char === '|' && !inCode) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function renderTable(rows) {
  const alignments = splitRow(rows[1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const style = (index) => (alignments[index] ? ` style="text-align:${alignments[index]}"` : '');
  const head = splitRow(rows[0]);
  const body = rows.slice(2).map((row) => splitRow(row));
  // Columns whose every value is short (IDs, statuses, one-word labels) must not wrap mid-token.
  const tight = head.map((cell, index) =>
    [cell, ...body.map((row) => row[index] ?? '')].every((value) => value.length <= 14),
  );
  const cls = (index) => (tight[index] ? ' class="tight"' : '');
  const out = ['<table>', '<thead>', '<tr>'];
  head.forEach((cell, index) => out.push(`<th${cls(index)}${style(index)}>${renderInline(cell)}</th>`));
  out.push('</tr>', '</thead>');
  if (body.length) {
    out.push('<tbody>');
    for (const row of body) {
      out.push('<tr>');
      for (let index = 0; index < head.length; index += 1) {
        out.push(`<td${cls(index)}${style(index)}>${renderInline(row[index] ?? '')}</td>`);
      }
      out.push('</tr>');
    }
    out.push('</tbody>');
  }
  out.push('</table>');
  return out.join('\n');
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 70);
}

/**
 * Renders a markdown document to HTML.
 * @returns {{html: string, headings: Array<{level: number, text: string, id: string}>}}
 */
function renderMarkdown(markdown, idPrefix = '') {
  const headings = [];
  const usedIds = new Map();

  const uniqueId = (label) => {
    const base = `${idPrefix}${slugify(label) || 'section'}`;
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  const renderBlocks = (lines) => {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }

      if (/^\s*```/.test(line)) {
        const language = line.replace(/^\s*```/, '').trim();
        const code = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        const text = heading[2].trim();
        const id = uniqueId(text);
        headings.push({ level, text: text.replace(/[*`]/g, ''), id });
        const cls = level === 1 ? ' class="doc-start"' : '';
        out.push(`<h${level}${cls} id="${id}">${renderInline(text)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(lines[i]);
          i += 1;
        }
        out.push(renderTable(rows));
        continue;
      }

      if (/^\s*>/.test(line)) {
        const inner = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          inner.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push(`<blockquote>\n${renderBlocks(inner)}\n</blockquote>`);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const start = Number(line.match(/^\s*(\d+)\./)[1]);
        const items = [];
        while (i < lines.length) {
          const match = lines[i].match(/^\s*(\d+)\.\s+(.*)$/);
          if (!match) break;
          items.push(match[2]);
          i += 1;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i += 1;
          }
        }
        const attr = start === 1 ? '' : ` start="${start}"`;
        out.push(`<ol${attr}>`);
        for (const item of items) out.push(`<li>${renderInline(item)}</li>`);
        out.push('</ol>');
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length) {
          const match = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
          if (!match) break;
          if (match[1].length >= 2 && items.length) {
            const sub = [];
            while (i < lines.length) {
              const subMatch = lines[i].match(/^\s{2,}[-*+]\s+(.*)$/);
              if (!subMatch) break;
              sub.push(subMatch[1]);
              i += 1;
            }
            items[items.length - 1].children.push(...sub);
            continue;
          }
          items.push({ text: match[2], children: [] });
          i += 1;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i += 1;
          }
        }
        out.push('<ul>');
        for (const item of items) {
          const nested = item.children.length
            ? `<ul>${item.children.map((child) => `<li>${renderInline(child)}</li>`).join('')}</ul>`
            : '';
          out.push(`<li>${renderInline(item.text)}${nested}</li>`);
        }
        out.push('</ul>');
        continue;
      }

      const paragraph = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*(#{1,6}\s|>|```|\|)/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
      ) {
        paragraph.push(lines[i].trim());
        i += 1;
      }
      if (paragraph.length) out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      else i += 1;
    }
    return out.join('\n');
  };

  const html = renderBlocks(markdown.replace(/\r\n/g, '\n').split('\n'));
  return { html, headings };
}



/* ------------------------------------------------------------------- style */

const STYLE = `
@page { size: A4; margin: 17mm 15mm 16mm 15mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: "Segoe UI", Calibri, "Helvetica Neue", Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.45;
  color: #16191d;
}
h1, h2, h3, h4 { font-family: "Segoe UI Semibold", "Segoe UI", Calibri, Arial, sans-serif; color: #10334f; page-break-after: avoid; }
h1.doc-start {
  font-size: 16pt;
  line-height: 1.25;
  margin: 0 0 8pt;
  padding-bottom: 4pt;
  border-bottom: 2.2pt solid #1f4e79;
  page-break-before: always;
}
h1.doc-start.first { page-break-before: avoid; }
h2 { font-size: 12pt; margin: 14pt 0 5pt; }
h3 { font-size: 10.6pt; margin: 11pt 0 4pt; color: #23405c; }
p { margin: 0 0 6pt; }
strong { color: #0b1b2b; font-weight: 600; }
em { color: #2b3d4f; }
ul, ol { margin: 4pt 0 7pt; padding-left: 16pt; }
li { margin: 0 0 2.5pt; }
li > ul { margin: 2pt 0; }
hr { border: 0; border-top: 0.8pt solid #cfd8e2; margin: 10pt 0; }
code {
  font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
  font-size: 8.4pt;
  background: #eef1f5;
  border-radius: 2pt;
  padding: 0 1.6pt;
  color: #1c2b3a;
  word-break: break-word;
  overflow-wrap: anywhere;
}
pre {
  background: #f5f7fa;
  border-left: 2.5pt solid #1f4e79;
  border-radius: 2pt;
  margin: 6pt 0 9pt;
  padding: 6pt 8pt;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: 8.2pt; line-height: 1.35; }
blockquote {
  margin: 6pt 0 8pt;
  padding: 4pt 8pt;
  border-left: 2.5pt solid #93a9bf;
  background: #fafbfd;
  color: #2a3441;
}
blockquote p:last-child { margin-bottom: 0; }
blockquote h1, blockquote h2, blockquote h3 { font-size: 10.6pt; margin: 6pt 0 3pt; border: 0; page-break-before: avoid; padding: 0; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 5pt 0 10pt;
  font-size: 8.1pt;
  line-height: 1.35;
}
thead { display: table-header-group; }
th, td { border: 0.6pt solid #b3c0cd; padding: 2.6pt 3.4pt; vertical-align: top; }
th { background: #e6edf4; font-weight: 600; text-align: left; color: #10334f; }
th.tight, td.tight { white-space: nowrap; }
tr { page-break-inside: avoid; }
tbody tr:nth-child(even) td { background: #fafcfd; }
.cover { page-break-after: always; padding-top: 42mm; }
.cover .rule { border-top: 3pt solid #1f4e79; width: 42mm; margin: 0 0 10pt; }
.cover h1 { font-size: 24pt; line-height: 1.2; border: 0; padding: 0; margin: 0 0 6pt; page-break-before: avoid; }
.cover .sub { font-size: 12.5pt; color: #34506b; margin: 0 0 20pt; }
.cover dl { font-size: 9.6pt; margin: 0; }
.cover dt { float: left; width: 36mm; color: #5a6b7c; clear: left; }
.cover dd { margin: 0 0 3pt 36mm; }
.cover .note {
  margin-top: 18mm;
  border: 0.7pt solid #c8d3de;
  background: #f7f9fb;
  padding: 7pt 9pt;
  font-size: 8.8pt;
  color: #2b3a49;
}
.toc { page-break-after: always; }
.toc h1 { font-size: 15pt; border-bottom: 2.2pt solid #1f4e79; padding-bottom: 3pt; margin: 0 0 9pt; page-break-before: avoid; }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0; padding: 0; }
.toc a { color: #10334f; text-decoration: none; }
.toc .lvl1 { font-size: 9.8pt; font-weight: 600; margin-top: 5pt; }
.toc .lvl1 .idx { display: inline-block; width: 10mm; color: #6b7d90; font-weight: 400; }
.toc .lvl2 { font-size: 8.4pt; color: #44586c; padding-left: 10mm; line-height: 1.4; }
`;

function documentShell(title, bodyHtml, coverHtml = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${coverHtml}${bodyHtml}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ chrome */

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No Chrome or Edge executable found; install one or extend CHROME_CANDIDATES.');
}

/* -------------------------------------------------------------------- main */

function readDocuments(filter) {
  const available = fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => !filter || name === filter);
  const ordered = ORDER.filter((name) => available.includes(name));
  for (const name of available.slice().sort()) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

function pageCount(pdfPath) {
  const raw = fs.readFileSync(pdfPath).toString('latin1');
  const declared = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  if (declared.length) return Math.max(...declared);
  return [...raw.matchAll(/\/Type\s*\/Page[^s]/g)].length;
}

function coverMarkup(totalDocuments, today) {
  return `<section class="cover">
  <div class="rule"></div>
  <h1>Student Beneficiary Management System<br>Chapters 4&ndash;6 Documentation and Evidence Package</h1>
  <p class="sub">Markdown sources rendered to PDF for review and handover</p>
  <dl>
    <dt>Repository</dt><dd>student-beneficiary-system</dd>
    <dt>Branch</dt><dd>${escapeHtml(BRANCH)}</dd>
    <dt>Evidence revision</dt><dd>${escapeHtml(EVIDENCE_REVISION)}</dd>
    <dt>Documents</dt><dd>${totalDocuments} markdown files</dd>
    <dt>Rendered</dt><dd>${today}</dd>
  </dl>
  <div class="note">
    <strong>What this PDF is.</strong> A rendering of the markdown files in
    <code>docs/final-documentation-content/</code>. It adds no new claims: every statement stays bounded to
    revision <code>${escapeHtml(EVIDENCE_REVISION)}</code>, and every open gap stays visible &mdash; hardware
    specification, figures, screenshots, user acceptance testing, phone camera scan, Azure ML runtime path and the
    two test generations. Regenerate with <code>node scripts/docs-to-pdf.mjs</code>.
  </div>
</section>`;
}

function main() {
  const argv = process.argv.slice(2);
  const onlyArg = argv.find((arg) => arg.startsWith('--only='));
  const filter = onlyArg ? onlyArg.slice('--only='.length) : null;
  const onlyCombined = argv.includes('--combined');
  const onlyIndividual = argv.includes('--individual');
  const wantAll = argv.includes('--all');
  // Additive, so passing both flags (or neither) means "both" rather than silently doing nothing.
  const wantCombined = onlyCombined || !onlyIndividual;
  const wantIndividual = onlyIndividual || !onlyCombined;

  const chrome = findChrome();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbms-docpdf-'));

  const documents = readDocuments(filter);
  if (!documents.length) throw new Error(`No markdown matched ${filter ?? '(all)'} in ${SRC_DIR}`);

  const rendered = new Map();
  documents.forEach((name, index) => {
    const markdown = fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
    rendered.set(name, renderMarkdown(markdown, wantCombined ? `d${index + 1}-` : ''));
  });

  const report = [];

  if (wantIndividual) {
    const standalone =
      filter || wantAll ? documents : documents.filter((name) => DELIVERABLES.includes(name));
    const produced = new Set([COMBINED_NAME]);
    for (const name of standalone) {
      const { html } = rendered.get(name);
      const base = path.basename(name, '.md');
      const htmlPath = path.join(workDir, `${base}.html`);
      const pdfPath = path.join(OUT_DIR, `${base}.pdf`);
      const withFirstFlag = html.replace('<h1 class="doc-start"', '<h1 class="doc-start first"');
      fs.writeFileSync(htmlPath, documentShell(base, withFirstFlag), 'utf8');
      const bytes = printPdf({ chrome, htmlPath, pdfPath, workDir });
      produced.add(`${base}.pdf`);
      report.push({ file: `${base}.pdf`, pages: pageCount(pdfPath), bytes });
    }
    if (!filter) {
      // A full run owns the output folder: remove PDFs this run did not produce, so a wider
      // earlier run cannot leave duplicate copies behind.
      const pruned = fs
        .readdirSync(OUT_DIR)
        .filter((entry) => entry.endsWith('.pdf') && !produced.has(entry));
      for (const entry of pruned) fs.rmSync(path.join(OUT_DIR, entry));
      if (pruned.length) console.log(`Pruned ${pruned.length} PDF(s) not in this set: ${pruned.join(', ')}`);
    }
  }

  if (wantCombined && !filter) {
    const today = new Date().toISOString().slice(0, 10);
    const tocRows = [];
    documents.forEach((name, index) => {
      const { headings } = rendered.get(name);
      const first = headings.find((heading) => heading.level === 1);
      const title = first ? first.text : name.replace(/\.md$/, '');
      tocRows.push(
        `<li class="lvl1"><span class="idx">${index + 1}</span><a href="#${first ? first.id : ''}">${escapeHtml(title)}</a></li>`,
      );
      for (const heading of headings.filter((item) => item.level === 2)) {
        tocRows.push(`<li class="lvl2"><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`);
      }
    });

    const body = `<section class="toc">
  <h1>Contents</h1>
  <ul>
${tocRows.join('\n')}
  </ul>
</section>
${documents.map((name) => `<section class="part" data-doc="${escapeHtml(name)}">\n${rendered.get(name).html}\n</section>`).join('\n')}`;

    const htmlPath = path.join(workDir, 'combined.html');
    const pdfPath = path.join(OUT_DIR, COMBINED_NAME);
    fs.writeFileSync(
      htmlPath,
      documentShell('SBMS Chapters 4-6 Documentation and Evidence Package', body, coverMarkup(documents.length, today)),
      'utf8',
    );
    const bytes = printPdf({ chrome, htmlPath, pdfPath, workDir });
    report.push({ file: COMBINED_NAME, pages: pageCount(pdfPath), bytes });
  }

  console.log(`Rendered with ${path.basename(chrome)}: ${report.length} PDF(s) from ${documents.length} markdown files`);
  for (const item of report) {
    console.log(`  ${item.file.padEnd(64)} ${String(item.pages).padStart(4)} pages ${(item.bytes / 1024).toFixed(0).padStart(6)} KB`);
  }
  console.log(`Output: ${path.relative(process.cwd(), OUT_DIR)}`);
}

function printPdf({ chrome, htmlPath, pdfPath, workDir }) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=10000',
    `--user-data-dir=${path.join(workDir, 'chrome-profile')}`,
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ];
  const result = spawnSync(chrome, args, { encoding: 'utf8', timeout: 240000 });
  if (result.error) throw result.error;
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Chrome produced no PDF for ${path.basename(htmlPath)}: ${result.stderr || result.stdout}`);
  }
  return fs.statSync(pdfPath).size;
}

main();

