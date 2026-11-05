const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// A4 LANDSCAPE CERTIFICATE.
//
// The design is a formal document, not a report: an ivory sheet, a double navy-and-gold frame with
// ornamental corners, a serif heading, the beneficiary's name centred at display size, a quiet grid
// of award facts, a seal emblem and one verification block. Everything is drawn from vector
// primitives and text, and the QR code is embedded as bytes generated in this process, so a
// downloaded certificate never depends on an image URL that could disappear.
//
// Nothing here claims an authority the system does not have: there is no crest, no government logo,
// no imitated signature and no invented signatory. An operator who really has a constituency name
// or an authorised signatory can configure one (`config/certificateIdentity`), and only then does
// that block appear.
const NAVY = '#12294A';
const NAVY_DEEP = '#0B1B33';
const GOLD = '#AE8B3C';
const GOLD_DEEP = '#8A6C2C';
const GOLD_SOFT = '#D6C39A';
const IVORY = '#FCFAF3';
const INK = '#243447';
const MUTED = '#5D6C7E';
const RULE = '#E3D8BE';

const PAPER_WIDTH = 841.89;
const PAPER_HEIGHT = 595.28;
const EDGE = 22;
const FRAME = 30;
const CONTENT_LEFT = 68;
const CONTENT_WIDTH = PAPER_WIDTH - CONTENT_LEFT * 2;

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  return `KSh ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Every string the certificate prints, built from the stored row and the configured identity. It is
// a separate function so the wording can be tested without parsing a PDF stream, and so a missing
// fact is omitted rather than printed as "undefined" or filled with an invented value.
function certificateContent({ certificate, identity = {}, manualVerificationUrl }) {
  const programme = (identity.programme || 'bursary programme').trim();
  const school = (certificate.school_code || '').trim();

  const facts = [];
  if (school) facts.push({ label: 'Institution', value: school });
  if (certificate.award_period) facts.push({ label: 'Academic year', value: certificate.award_period });
  if (Number.isFinite(Number(certificate.approved_amount))) {
    facts.push({ label: 'Approved bursary award', value: money(certificate.approved_amount) });
  }
  if (identity.constituency) facts.push({ label: 'Constituency', value: identity.constituency });
  if (certificate.issued_at) facts.push({ label: 'Date of issue', value: longDate(certificate.issued_at) });
  if (certificate.award_approved_at) {
    facts.push({ label: 'Award approved', value: longDate(certificate.award_approved_at) });
  }

  return {
    programme,
    programmeHeading: programme.toUpperCase(),
    constituency: identity.constituency || null,
    signatory: identity.signatory || null,
    beneficiaryName: (certificate.student_name || '').trim(),
    heading: 'CERTIFICATE',
    subheading: 'OF BURSARY AWARD',
    preamble: 'This is to certify that',
    statement: `has been recognised as an approved beneficiary of the ${programme}, having received `
      + 'an approved bursary award as recorded in the Student Beneficiary Management System.',
    facts,
    reference: certificate.certificate_reference,
    manualVerificationUrl: manualVerificationUrl || '',
    footnote: 'Approval is not payment: this certificate records an approved bursary decision in SBMS, '
      + 'and is not a government seal or endorsement.',
  };
}

function centredText(doc, text, y, options = {}) {
  const {
    font = 'Times-Roman', size = 11, color = INK, spacing = 0, width = CONTENT_WIDTH, x = CONTENT_LEFT,
  } = options;
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(text, x, y, { width, align: 'center', characterSpacing: spacing });
  return doc.y;
}

function rule(doc, y, width, { x = (PAPER_WIDTH - width) / 2, color = GOLD, weight = 0.9 } = {}) {
  doc.save().lineWidth(weight).strokeColor(color)
    .moveTo(x, y).lineTo(x + width, y).stroke().restore();
}


function longDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// A small L-shaped flourish with a lozenge, mirrored into each corner. Two strokes rather than one
// keep the ornament quiet enough to read as a printed certificate frame rather than decoration.
function drawCornerFlourish(doc, x, y, dx, dy) {
  doc.save()
    .lineWidth(1).strokeColor(GOLD_SOFT)
    .moveTo(x + dx * 46, y).lineTo(x, y).lineTo(x, y + dy * 46).stroke()
    .lineWidth(0.5)
    .moveTo(x + dx * 34, y + dy * 9).lineTo(x + dx * 9, y + dy * 9).lineTo(x + dx * 9, y + dy * 34).stroke()
    .restore();

  const cx = x + dx * 20;
  const cy = y + dy * 20;
  doc.save().fillColor(GOLD)
    .polygon([cx, cy - 3.4], [cx + 3.4, cy], [cx, cy + 3.4], [cx - 3.4, cy])
    .fill()
    .restore();
}

function drawFrame(doc) {
  doc.rect(0, 0, PAPER_WIDTH, PAPER_HEIGHT).fill(IVORY);

  doc.save().lineWidth(2.6).strokeColor(NAVY)
    .rect(EDGE, EDGE, PAPER_WIDTH - EDGE * 2, PAPER_HEIGHT - EDGE * 2).stroke().restore();
  doc.save().lineWidth(0.8).strokeColor(GOLD)
    .rect(FRAME, FRAME, PAPER_WIDTH - FRAME * 2, PAPER_HEIGHT - FRAME * 2).stroke().restore();

  const right = PAPER_WIDTH - FRAME;
  const bottom = PAPER_HEIGHT - FRAME;
  drawCornerFlourish(doc, FRAME, FRAME, 1, 1);
  drawCornerFlourish(doc, right, FRAME, -1, 1);
  drawCornerFlourish(doc, FRAME, bottom, 1, -1);
  drawCornerFlourish(doc, right, bottom, -1, -1);
}

// A generic rosette, drawn from circles and two tapered tails. It marks the document as an issued
// SBMS certificate; it is deliberately not modelled on a coat of arms or any state emblem.
function drawSeal(doc, cx, cy, radius) {
  doc.save().fillColor(GOLD_SOFT)
    .polygon([cx - radius + 6, cy + radius - 14], [cx - radius - 2, cy + radius + 20], [cx - 2, cy + radius + 2])
    .fill()
    .polygon([cx + radius - 6, cy + radius - 14], [cx + radius + 2, cy + radius + 20], [cx + 2, cy + radius + 2])
    .fill()
    .restore();

  doc.save().lineWidth(1.6).strokeColor(GOLD).circle(cx, cy, radius).stroke()
    .lineWidth(0.6).strokeColor(GOLD_DEEP).circle(cx, cy, radius - 3.5).stroke()
    .restore();

  doc.save().fillColor(NAVY).circle(cx, cy, radius - 7).fill().restore();

  doc.font('Times-Bold').fontSize(12).fillColor(GOLD_SOFT);
  doc.text('SBMS', cx - radius, cy - 12, { width: radius * 2, align: 'center' });
  doc.font('Times-Roman').fontSize(4.8).fillColor(GOLD_SOFT);
  doc.text('BURSARY', cx - radius, cy + 2, { width: radius * 2, align: 'center', characterSpacing: 0.7 });
  doc.text('AWARD', cx - radius, cy + 8.5, { width: radius * 2, align: 'center', characterSpacing: 0.7 });
}

function drawFacts(doc, facts, top, rowHeight = 46) {
  if (facts.length === 0) return top;

  const columns = 3;
  const gutter = 20;
  const columnWidth = (CONTENT_WIDTH - gutter * (columns - 1)) / columns;
  const rows = Math.ceil(facts.length / columns);
  const height = rows * rowHeight;

  rule(doc, top - 12, CONTENT_WIDTH, { x: CONTENT_LEFT, color: RULE, weight: 0.7 });
  rule(doc, top + height - 2, CONTENT_WIDTH, { x: CONTENT_LEFT, color: RULE, weight: 0.7 });

  for (let column = 1; column < columns; column += 1) {
    const x = CONTENT_LEFT + column * (columnWidth + gutter) - gutter / 2;
    doc.save().lineWidth(0.5).strokeColor(RULE)
      .moveTo(x, top + 4).lineTo(x, top + height - 10).stroke().restore();
  }

  facts.forEach((fact, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = CONTENT_LEFT + column * (columnWidth + gutter);
    const y = top + row * rowHeight;

    doc.font('Times-Roman').fontSize(7.4).fillColor(GOLD_DEEP)
      .text(fact.label.toUpperCase(), x, y, { width: columnWidth, align: 'center', characterSpacing: 1.2 });
    doc.font('Times-Bold').fontSize(12).fillColor(NAVY_DEEP)
      .text(fact.value, x, y + 12, { width: columnWidth, align: 'center' });
  });

  return top + height;
}

async function renderCertificatePdf({ certificate, verificationUrl, manualVerificationUrl, identity }) {
  const content = certificateContent({ certificate, identity, manualVerificationUrl });
  // 560 px across an 84 pt square is ~480 DPI, well beyond what an office laser printer resolves,
  // and the quiet zone is the two modules the QR specification asks for.
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: 'png', margin: 2, width: 560 });

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE },
    info: {
      Title: `Certificate of Bursary Award ${certificate.certificate_reference}`,
      Author: 'Student Beneficiary Management System (SBMS)',
      Subject: 'Certificate of an approved bursary award',
      Keywords: certificate.certificate_reference,
      // Pinned to the issue date so that downloading the same issued certificate twice produces
      // byte-identical output: a reprint cannot be mistaken for a second, different document.
      CreationDate: certificate.issued_at ? new Date(certificate.issued_at) : new Date(0),
    },
  });

  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawFrame(doc);

  centredText(doc, 'STUDENT BENEFICIARY MANAGEMENT SYSTEM', 58, {
    size: 9.2, color: NAVY, spacing: 2.6,
  });
  centredText(doc, 'SBMS  ·  BURSARY AWARDS REGISTER', 71, { size: 7.2, color: MUTED, spacing: 2.2 });

  const identityLine = content.constituency
    ? `${content.programmeHeading}  ·  ${content.constituency.toUpperCase()}`
    : content.programmeHeading;
  centredText(doc, identityLine, 88, { size: 9.4, color: GOLD_DEEP, spacing: 2.2 });

  rule(doc, 106, 128);

  centredText(doc, content.heading, 118, { font: 'Times-Bold', size: 38, color: NAVY_DEEP, spacing: 7 });
  centredText(doc, content.subheading, 162, { size: 14.5, color: GOLD_DEEP, spacing: 5.4 });
  rule(doc, 184, 74, { weight: 0.8 });

  centredText(doc, content.preamble, 196, { font: 'Times-Italic', size: 11.2, color: MUTED });

  // The beneficiary's name is the centre of the document: serif, given the widest measure on the
  // page, and shrunk rather than wrapped awkwardly when a name is unusually long.
  const nameWidth = CONTENT_WIDTH - 90;
  const nameTop = 214;
  let nameSize = 16;
  for (const candidate of [32, 30, 28, 26, 24, 22, 20, 18, 16]) {
    doc.font('Times-Bold').fontSize(candidate);
    if (doc.widthOfString(content.beneficiaryName) <= nameWidth) {
      nameSize = candidate;
      break;
    }
  }

  // Everything below the name is measured before it is drawn. The facts grid and the verification
  // band sit on fixed anchors, so a long name or a long statement cannot push the QR code or the
  // footnote past the paper edge and onto a second page.
  doc.font('Times-Bold').fontSize(nameSize);
  const nameHeight = doc.heightOfString(content.beneficiaryName, { width: nameWidth, align: 'center' });
  const statementTop = nameTop + nameHeight + 20;
  const statementWidth = CONTENT_WIDTH - 104;

  let statementSize = 9;
  let statementHeight = 0;
  for (const candidate of [11.2, 10.6, 10, 9.6, 9]) {
    doc.font('Times-Roman').fontSize(candidate);
    const height = doc.heightOfString(content.statement, {
      width: statementWidth, align: 'center', lineGap: 3.2,
    });
    statementSize = candidate;
    statementHeight = height;
    if (statementTop + height <= 316) break;
  }

  doc.font('Times-Bold').fontSize(nameSize).fillColor(NAVY_DEEP);
  doc.text(content.beneficiaryName, CONTENT_LEFT + 45, nameTop, { width: nameWidth, align: 'center' });
  rule(doc, nameTop + nameHeight + 6, 180, { weight: 0.6, color: GOLD_SOFT });

  doc.font('Times-Roman').fontSize(statementSize).fillColor(INK);
  doc.text(content.statement, CONTENT_LEFT + 52, statementTop, {
    width: statementWidth, align: 'center', lineGap: 3.2,
  });

  const BAND_TOP = 424;
  const rowCount = Math.max(1, Math.ceil(content.facts.length / 3));
  const factsTop = Math.min(statementTop + statementHeight + 22, 322);
  const rowHeight = Math.max(26, Math.min(46, Math.floor((BAND_TOP - 18 - factsTop) / rowCount)));
  drawFacts(doc, content.facts, factsTop, rowHeight);

  // Verification block, bottom right: QR, printed reference, and the page a reader can type it into.
  const bandTop = BAND_TOP;
  const qrSize = 84;
  const verifyWidth = 184;
  const verifyX = PAPER_WIDTH - CONTENT_LEFT - verifyWidth;
  const qrX = verifyX + (verifyWidth - qrSize) / 2;

  doc.image(qrPng, qrX, bandTop, { width: qrSize, height: qrSize });
  doc.font('Times-Roman').fontSize(6.8).fillColor(NAVY)
    .text('SCAN TO VERIFY', verifyX, bandTop + qrSize + 7, { width: verifyWidth, align: 'center', characterSpacing: 1.3 });
  doc.font('Times-Roman').fontSize(6.2).fillColor(GOLD_DEEP)
    .text('CERTIFICATE REFERENCE', verifyX, bandTop + qrSize + 19, {
      width: verifyWidth, align: 'center', characterSpacing: 1,
    });
  doc.font('Times-Bold').fontSize(10).fillColor(NAVY_DEEP)
    .text(content.reference, verifyX, bandTop + qrSize + 29, { width: verifyWidth, align: 'center' });
  doc.font('Times-Roman').fontSize(6.2).fillColor(MUTED)
    .text(content.manualVerificationUrl.replace(/^https?:\/\//, ''), verifyX, bandTop + qrSize + 43, {
      width: verifyWidth, align: 'center',
    });

  // Authorisation block, bottom left. A signature line appears only when a real signatory is
  // configured; otherwise the document states plainly that it was issued electronically.
  doc.font('Times-Roman').fontSize(7).fillColor(GOLD_DEEP)
    .text('AUTHORISED SIGNATORY', CONTENT_LEFT, bandTop, { width: 210, characterSpacing: 1.2 });

  if (content.signatory) {
    doc.font('Times-Bold').fontSize(12).fillColor(NAVY_DEEP)
      .text(content.signatory.name, CONTENT_LEFT, bandTop + 14, { width: 210 });
    if (content.signatory.designation) {
      doc.font('Times-Italic').fontSize(9).fillColor(MUTED)
        .text(content.signatory.designation, CONTENT_LEFT, bandTop + 31, { width: 210 });
    }
    rule(doc, bandTop + 54, 190, { x: CONTENT_LEFT, weight: 0.7, color: GOLD });
    doc.font('Times-Roman').fontSize(6.4).fillColor(MUTED)
      .text('Signature', CONTENT_LEFT, bandTop + 58, { width: 190 });
  } else {
    doc.font('Times-Roman').fontSize(9.4).fillColor(INK)
      .text('Issued electronically by SBMS', CONTENT_LEFT, bandTop + 14, { width: 210 });
    doc.font('Times-Roman').fontSize(7.2).fillColor(MUTED)
      .text('No handwritten signature or ink seal is required for this certificate.', CONTENT_LEFT, bandTop + 30, {
        width: 200, lineGap: 1.4,
      });
  }

  drawSeal(doc, PAPER_WIDTH / 2 - 4, bandTop + 40, 33);

  doc.font('Times-Roman').fontSize(6.8).fillColor(MUTED)
    .text(content.footnote, CONTENT_LEFT + 16, 540, { width: 452, lineGap: 1.6 });

  doc.end();
  return finished;
}

module.exports = { renderCertificatePdf, certificateContent, money, longDate };
