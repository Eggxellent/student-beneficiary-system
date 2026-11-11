const PDFDocument = require('pdfkit');

// Same palette as the issued certificate, so a report and a certificate read as one system.
const NAVY = '#12294A';
const GOLD = '#AE8B3C';
const GOLD_SOFT = '#D6C39A';
const IVORY = '#FCFAF3';
const INK = '#243447';
const MUTED = '#5D6C7E';
const RULE = '#E3D8BE';
const GREEN = '#1F7A4D';
const RED = '#A63232';
const AMBER = '#8A6C2C';
const GREEN_SOFT = '#E9F3EC';
const RED_SOFT = '#F9EBEB';
const AMBER_SOFT = '#FBF3E1';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 44;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_TOP = PAGE_H - 54;
const BAND_H = 128;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 'KES 0';
  return `KES ${amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

function shortDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Not recorded';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function shortDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${shortDate(date)}, ${hh}:${mm} UTC`;
}

// Each award state carries its own ink, so a decision is readable without reading the word.
function statusStyle(status) {
  switch (status) {
    case 'approved':
      return { label: 'Approved', ink: GREEN, fill: GREEN_SOFT };
    case 'rejected':
      return { label: 'Rejected', ink: RED, fill: RED_SOFT };
    case 'submitted':
      return { label: 'Awaiting decision', ink: AMBER, fill: AMBER_SOFT };
    default:
      return { label: String(status || 'Unknown'), ink: MUTED, fill: IVORY };
  }
}

function drawHeaderBand(doc, data) {
  doc.rect(0, 0, PAGE_W, BAND_H).fill(NAVY);
  doc.rect(0, BAND_H, PAGE_W, 2.5).fill(GOLD);

  doc.font('Helvetica-Bold').fontSize(8.4).fillColor(GOLD)
    .text('STUDENT BENEFICIARY MANAGEMENT SYSTEM', MARGIN, 32, { characterSpacing: 2.1 });
  doc.font('Helvetica-Bold').fontSize(21).fillColor('#FFFFFF')
    .text('Beneficiary and Bursary Award Report', MARGIN, 48, { width: CONTENT_W - 150 });
  doc.font('Helvetica').fontSize(9.2).fillColor('#B9C6D8')
    .text(
      'Consolidated record of beneficiary registrations, duplicate screening and bursary award decisions for the reporting period.',
      MARGIN, 84, { width: CONTENT_W - 170, lineGap: 1.6 }
    );

  const rightX = PAGE_W - MARGIN - 142;
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor(GOLD)
    .text('REPORTING PERIOD', rightX, 38, { width: 142, align: 'right', characterSpacing: 1.3 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF')
    .text(`${shortDate(data.period.start_date)} - ${shortDate(data.period.end_date)}`, rightX, 50, { width: 142, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor(GOLD)
    .text('GENERATED', rightX, 78, { width: 142, align: 'right', characterSpacing: 1.3 });
  doc.font('Helvetica').fontSize(8.6).fillColor('#FFFFFF')
    .text(shortDateTime(data.generatedAt), rightX, 90, { width: 142, align: 'right' });
}

function drawRunningHeader(doc, data) {
  doc.rect(0, 0, PAGE_W, 54).fill(NAVY);
  doc.rect(0, 54, PAGE_W, 1.6).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD)
    .text('STUDENT BENEFICIARY MANAGEMENT SYSTEM', MARGIN, 18, { characterSpacing: 1.6 });
  doc.font('Helvetica').fontSize(8.6).fillColor('#FFFFFF')
    .text('Beneficiary and Bursary Award Report', MARGIN, 31, { width: CONTENT_W - 150 });
  doc.font('Helvetica').fontSize(8).fillColor('#B9C6D8')
    .text(`${shortDate(data.period.start_date)} - ${shortDate(data.period.end_date)}`, PAGE_W - MARGIN - 150, 31, { width: 150, align: 'right' });
}

function kpiCard(doc, x, y, width, card) {
  doc.rect(x, y, width, 64).fill(IVORY);
  doc.save().lineWidth(0.7).strokeColor(RULE).rect(x, y, width, 64).stroke().restore();
  doc.rect(x, y, 3, 64).fill(card.accent || GOLD);

  doc.font('Helvetica-Bold').fontSize(6.9).fillColor(MUTED)
    .text(card.label.toUpperCase(), x + 12, y + 12, { width: width - 20, characterSpacing: 0.8, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(card.size || 15.5).fillColor(card.ink || NAVY)
    .text(card.value, x + 12, y + 26, { width: width - 20 });
  doc.font('Helvetica').fontSize(6.9).fillColor(MUTED)
    .text(card.note || '', x + 12, y + 48, { width: width - 20 });
}

function sectionHeading(doc, y, index, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(7.4).fillColor(GOLD)
    .text(`SECTION ${index}`, MARGIN, y, { characterSpacing: 1.7 });
  doc.font('Helvetica-Bold').fontSize(12.4).fillColor(NAVY)
    .text(title, MARGIN, y + 11, { width: CONTENT_W });
  const titleBottom = doc.y + 4;
  doc.save().lineWidth(0.8).strokeColor(GOLD_SOFT)
    .moveTo(MARGIN, titleBottom).lineTo(PAGE_W - MARGIN, titleBottom).stroke().restore();
  let cursor = titleBottom + 9;
  if (subtitle) {
    doc.font('Helvetica').fontSize(8.8).fillColor(MUTED)
      .text(subtitle, MARGIN, cursor, { width: CONTENT_W, lineGap: 1.4 });
    cursor = doc.y + 8;
  }
  return cursor;
}

function pipelineShare(count, total) {
  if (!total) return 0;
  return Math.round((Number(count) / Number(total)) * 100);
}

// Navy header row plus a zebra body. Cells are pre-formatted strings, except a `chip` column which
// is drawn as a coloured pill so a decision reads at a glance.
function drawTable(doc, y, columns, rows, { state } = {}) {
  const headerH = 21;
  const rowH = 22;
  let cursor = y;

  const header = () => {
    doc.rect(MARGIN, cursor, CONTENT_W, headerH).fill(NAVY);
    let x = MARGIN;
    columns.forEach((column) => {
      doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#FFFFFF')
        .text(column.label.toUpperCase(), x + 8, cursor + 7, {
          width: column.width - 16,
          align: column.align || 'left',
          characterSpacing: 0.9,
        });
      x += column.width;
    });
    cursor += headerH;
  };

  header();

  rows.forEach((row, rowIndex) => {
    if (cursor + rowH > FOOTER_TOP - 20) {
      doc.addPage();
      if (state) state.onNewPage();
      cursor = state ? state.top() : 74;
      header();
    }
    if (rowIndex % 2 === 1) doc.rect(MARGIN, cursor, CONTENT_W, rowH).fill('#F7F8FA');
    doc.save().lineWidth(0.4).strokeColor(RULE)
      .moveTo(MARGIN, cursor + rowH).lineTo(PAGE_W - MARGIN, cursor + rowH).stroke().restore();

    let x = MARGIN;
    columns.forEach((column, columnIndex) => {
      const cell = row[columnIndex];
      if (column.chip) {
        const style = statusStyle(cell);
        const chipW = column.width - 18;
        doc.roundedRect(x + 8, cursor + 5, chipW, 13, 6.5).fill(style.fill);
        doc.font('Helvetica-Bold').fontSize(6.9).fillColor(style.ink)
          .text(style.label, x + 8, cursor + 8.4, { width: chipW, align: 'center' });
      } else {
        doc.font(column.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.4)
          .fillColor(column.ink || INK)
          .text(cell === null || cell === undefined || cell === '' ? '-' : String(cell), x + 8, cursor + 7, {
            width: column.width - 16,
            align: column.align || 'left',
            lineBreak: false,
            ellipsis: true,
          });
      }
      x += column.width;
    });
    cursor += rowH;
  });

  return cursor;
}

function drawNotice(doc, y, title, lines) {
  const height = 26 + lines.length * 11;
  doc.rect(MARGIN, y, CONTENT_W, height).fill(AMBER_SOFT);
  doc.rect(MARGIN, y, 3, height).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(7.6).fillColor(AMBER)
    .text(title.toUpperCase(), MARGIN + 12, y + 9, { characterSpacing: 1.1 });
  doc.font('Helvetica').fontSize(8.4).fillColor('#6B5622')
    .text(lines.join(' '), MARGIN + 12, y + 21, { width: CONTENT_W - 24, lineGap: 1.5 });
  return y + height;
}

function summaryParagraphs(data) {
  const { summary, period } = data;
  const share = pipelineShare(summary.approvedAwards, summary.totalAwards);
  const first = `Between ${shortDate(period.start_date)} and ${shortDate(period.end_date)} the system registered ${summary.studentsRegistered} beneficiary record(s)`
    + ` and received ${summary.totalAwards} bursary award submission(s) totalling ${money(summary.requestedAmount)} in requested support.`;
  const second = `The approving committee recorded ${summary.approvedAwards} approval(s) worth ${money(summary.approvedAmount)},`
    + ` which is ${share}% of the submissions received in the period, and ${summary.rejectedAwards} rejection(s).`
    + ` ${summary.awaitingDecision} award(s) still await a decision and ${summary.awaitingVerification} await beneficiary verification.`;
  const third = `Duplicate screening left ${summary.duplicateFlags} flag(s) pending review, and ${summary.studentsAssessed} of the ${summary.studentsRegistered} newly registered beneficiary record(s)`
    + ' carry a recorded eligibility assessment. Approved amounts are commitments; they are not disbursements.';
  return [first, second, third];
}

function renderObservations(doc, cursor, data, state) {
  const heading = sectionHeading(doc, cursor + 18, 4, 'Beneficiary and screening observations',
    'Signals an administrator should read alongside the award figures.');
  return drawTable(doc, heading + 2, [
    { label: 'Observation', width: 300 },
    { label: 'Count', width: 90, align: 'right' },
    { label: 'Reading', width: 117.28 },
  ], [
    ['Beneficiary records registered in period', String(data.summary.studentsRegistered), data.summary.studentsRegistered > 0 ? 'Reviewed by intake' : 'No new intake'],
    ['New records with an eligibility assessment', String(data.summary.studentsAssessed), data.summary.studentsAssessed >= data.summary.studentsRegistered ? 'Complete' : 'Incomplete'],
    ['Duplicate flags awaiting review', String(data.summary.duplicateFlags), data.summary.duplicateFlags > 0 ? 'Action required' : 'Clear'],
    ['Awards still awaiting a committee decision', String(data.summary.awaitingDecision), data.summary.awaitingDecision > 0 ? 'Action required' : 'Clear'],
  ], { state });
}

function renderFooters(doc, data) {
  const range = doc.bufferedPageRange();
  for (let page = 0; page < range.count; page += 1) {
    doc.switchToPage(range.start + page);
    // Without this the footer text sits below the page margin and pdfkit silently appends a page
    // for every footer it draws.
    doc.page.margins.bottom = 0;
    doc.save().lineWidth(0.7).strokeColor(GOLD_SOFT)
      .moveTo(MARGIN, PAGE_H - 42).lineTo(PAGE_W - MARGIN, PAGE_H - 42).stroke().restore();
    doc.font('Helvetica').fontSize(7.2).fillColor(MUTED)
      .text(
        `SBMS - Beneficiary and Bursary Award Report - ${shortDate(data.period.start_date)} to ${shortDate(data.period.end_date)}`,
        MARGIN, PAGE_H - 34, { width: CONTENT_W - 70, lineBreak: false, ellipsis: true }
      );
    doc.font('Helvetica-Bold').fontSize(7.2).fillColor(NAVY)
      .text(`Page ${page + 1} of ${range.count}`, PAGE_W - MARGIN - 90, PAGE_H - 34, { width: 90, align: 'right' });
  }
}


function drawSummary(doc, data) {
  let cursor = sectionHeading(doc, BAND_H + 108, 1, 'Executive summary',
    'Prepared from registrations, duplicate screening outcomes and recorded award decisions only.');
  summaryParagraphs(data).forEach((paragraph) => {
    doc.font('Helvetica').fontSize(9.3).fillColor(INK)
      .text(paragraph, MARGIN, cursor, { width: CONTENT_W, align: 'justify', lineGap: 2.4 });
    cursor = doc.y + 7;
  });
  return cursor;
}

function drawPipeline(doc, data, state, cursor) {
  const heading = sectionHeading(doc, cursor + 8, 2, 'Award pipeline',
    'Every submission received in the period, grouped by its current state.');
  const total = data.summary.totalAwards;
  return drawTable(doc, heading + 2, [
    { label: 'Stage', width: 190 },
    { label: 'Awards', width: 78, align: 'right' },
    { label: 'Value', width: 137, align: 'right' },
    { label: 'Share of submissions', width: 102.28, align: 'right' },
  ], [
    ['Approved', String(data.summary.approvedAwards), money(data.summary.approvedAmount), `${pipelineShare(data.summary.approvedAwards, total)}%`],
    ['Rejected', String(data.summary.rejectedAwards), money(0), `${pipelineShare(data.summary.rejectedAwards, total)}%`],
    ['Awaiting decision', String(data.summary.awaitingDecision), money(data.summary.pendingAmount), `${pipelineShare(data.summary.awaitingDecision, total)}%`],
    ['Awaiting beneficiary verification', String(data.summary.awaitingVerification), '-', `${pipelineShare(data.summary.awaitingVerification, total)}%`],
    ['Total submissions', String(total), money(data.summary.requestedAmount), '100%'],
  ], { state });
}


const DECISION_COLUMNS = [
  { label: '#', width: 24, align: 'right' },
  { label: 'Beneficiary', width: 116 },
  { label: 'School', width: 92 },
  { label: 'Category', width: 56 },
  { label: 'Decided', width: 62 },
  { label: 'Status', width: 88, chip: true },
  { label: 'Approved', width: 69.28, align: 'right' },
];

function drawDecisions(doc, data, state, cursor) {
  const heading = sectionHeading(doc, cursor + 18, 3, 'Award decisions',
    'Individual decisions recorded in the period, in the order the committee decided them.');
  if (!data.decisions.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
      .text('No award decisions were recorded for this reporting period.', MARGIN, heading + 2, { width: CONTENT_W });
    return doc.y + 10;
  }
  return drawTable(doc, heading + 2, DECISION_COLUMNS, data.decisions.map((row, index) => [
    String(index + 1),
    row.full_name,
    row.school_code || '-',
    row.eligibility_category || '-',
    shortDate(row.decided_at),
    row.status,
    row.approved_amount == null ? '-' : money(row.approved_amount).replace('KES ', ''),
  ]), { state });
}

function createReportDocument(data) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: 'Beneficiary and Bursary Award Report',
      Author: 'Student Beneficiary Management System',
      Subject: `Reporting period ${data.period.start_date} to ${data.period.end_date}`,
      Creator: 'SBMS',
    },
  });
  const state = {
    top: () => 74,
    onNewPage: () => drawRunningHeader(doc, data),
  };

  drawHeaderBand(doc, data);

  const gap = 9;
  const cardW = (CONTENT_W - gap * 3) / 4;
  const kpis = [
    { label: 'Students', value: String(data.summary.studentsRegistered), note: 'registered in period', accent: NAVY },
    { label: 'Approved awards', value: String(data.summary.approvedAwards), note: 'committee decisions', accent: GREEN },
    { label: 'Approved value', value: money(data.summary.approvedAmount), note: 'commitment, not paid', accent: GOLD, size: 11.6 },
    { label: 'Awaiting decision', value: String(data.summary.awaitingDecision), note: `${data.summary.awaitingVerification} need verification`, accent: AMBER },
  ];
  kpis.forEach((card, index) => kpiCard(doc, MARGIN + index * (cardW + gap), BAND_H + 22, cardW, card));

  let cursor = drawSummary(doc, data);
  cursor = drawPipeline(doc, data, state, cursor);
  cursor = drawDecisions(doc, data, state, cursor);
  cursor = renderObservations(doc, cursor, data, state);

  cursor = drawNotice(doc, cursor + 18, 'Scope and assurance', [
    'An approved award is a commitment recorded by the committee; it is not a payment and this report does not confirm disbursement.',
    `Report reference ${data.reportId}. Prepared by ${data.preparedBy} from records held by the Student Beneficiary Management System.`,
  ]);

  doc.font('Helvetica').fontSize(7.6).fillColor(MUTED)
    .text('Generated by the Student Beneficiary Management System. Retention and audit rules apply to this document.',
      MARGIN, cursor + 10, { width: CONTENT_W });

  renderFooters(doc, data);
  return doc;
}

module.exports = { createReportDocument, money, shortDate, statusStyle };

