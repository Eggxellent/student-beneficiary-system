const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// A4 PORTRAIT BURSARY APPROVAL INVOICE.
//
// The invoice replaces the landscape certificate as the paper an approved award produces. It is kept
// deliberately short: an issuing header, the document number and dates, a billed-to block holding
// the beneficiary's own record, one line item with its total, two notes, and a QR verification band.
// Each fact is printed once, or twice only where an accounting document needs it (the line amount
// and the total), so a reader never has to decide which of two statements is authoritative.
//
// Everything printed comes from the stored award/student snapshot (`bursary_certificates` row plus the
// live award status). Nothing is invented: a fact the record does not hold is omitted, and the status
// is derived from the award, never assumed.
const NAVY = '#0B2239';
const NAVY_DEEP = '#071A2C';
const TEAL = '#0E6E6B';
const GOLD = '#C8A45D';
const GOLD_DEEP = '#8A6C2C';
const IVORY = '#FBF9F4';
const INK = '#1F2D3A';
const MUTED = '#5C6B78';
const RULE = '#D9DFE3';

const PAPER_WIDTH = 595.28;
const PAPER_HEIGHT = 841.89;
const LEFT = 56;
const RIGHT = PAPER_WIDTH - LEFT;
const WIDTH = RIGHT - LEFT;

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  return `KSh ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plainAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// The header prints on a fixed grid, so a heading is shrunk until it fits its column rather than
// being allowed to wrap onto the line underneath it.
function fitFontSize(doc, text, { sizes, width, font = 'Helvetica-Bold', characterSpacing = 0 }) {
  for (const size of sizes) {
    doc.font(font).fontSize(size);
    if (doc.widthOfString(text, { characterSpacing }) <= width) return size;
  }
  return sizes[sizes.length - 1];
}

function hr(doc, y, { x = LEFT, width = WIDTH, color = RULE, weight = 0.7 } = {}) {
  doc.save().lineWidth(weight).strokeColor(color).moveTo(x, y).lineTo(x + width, y).stroke().restore();
}

// Every string the invoice prints, built from the stored row and the configured identity. Kept apart
// from the drawing code so the wording can be tested without parsing a PDF stream.
function invoiceContent({ certificate, identity = {}, manualVerificationUrl }) {
  const information = certificate || {};
  const programme = (identity.programme || 'bursary programme').trim();
  const name = (information.student_name || '').trim();
  const upi = (information.student_upi || '').trim();
  const school = (information.school_code || '').trim();
  const period = (information.award_period || '').trim();
  const amount = Number(information.approved_amount);
  const amountKnown = Number.isFinite(amount);

  // The invoice is a snapshot of an approval. If the award it names is no longer approved, or its
  // approved amount changed after the document was written, the document says so instead of
  // restating a superseded decision as current.
  const stillApproved = !information.award_status || information.award_status === 'approved';
  const amountUnchanged = information.award_live_amount == null
    || Number(information.award_live_amount) === amount;
  const current = stillApproved && amountUnchanged;

  // Only facts the record holds, and each fact printed once: the award period belongs to the line
  // item, so it is not repeated as a beneficiary field, and the constituency belongs to the
  // issuing office in the header, not to the student.
  const beneficiary = [
    upi && { label: 'UPI / student no.', value: upi },
    school && { label: 'Institution', value: school },
  ].filter(Boolean);

  const description = period ? `Bursary award, ${period}` : 'Bursary award';

  return {
    title: 'BURSARY APPROVAL INVOICE',
    subtitle: 'Official record of an approved bursary award',
    organisation: {
      name: 'STUDENT BENEFICIARY MANAGEMENT SYSTEM',
      programme,
      programmeHeading: programme.toUpperCase(),
      constituency: identity.constituency || null,
      issuingAuthority: identity.issuingAuthority || 'Student Beneficiary Management System (SBMS)',
    },
    beneficiaryName: name,
    beneficiary,
    invoiceNumber: information.certificate_reference,
    status: {
      label: current ? 'APPROVED' : 'SUPERSEDED',
      tone: current ? 'approved' : 'superseded',
    },
    dates: {
      issued: shortDate(information.issued_at),
      approved: shortDate(information.award_approved_at),
    },
    lineItems: [{
      description,
      amount: amountKnown ? plainAmount(amount) : 'Not recorded',
    }],
    // The amount appears twice by design and only twice: once as the line amount and once as the
    // total. Every extra statement of the same figure is a place for the two to disagree.
    total: {
      label: 'Total approved',
      value: amountKnown ? money(amount) : 'Not recorded',
    },
    notes: [
      'Approval is not payment.',
      `Quote invoice number ${information.certificate_reference || '(not recorded)'} in all correspondence.`,
    ],
    verification: {
      instructions: 'Scan for the live record: approval status and any payment recorded.',
      url: manualVerificationUrl || '',
    },
    signatory: identity.signatory || null,
    footnote: 'Issued electronically by SBMS. Not a tax invoice or a receipt.',
  };
}

// Draws one invoice. The page is measured from fixed anchors so that a long name, institution or
// description cannot push the total, the notes or the verification band off the sheet and onto page
// two.
async function renderInvoicePdf({ certificate, verificationUrl, manualVerificationUrl, identity }) {
  const content = invoiceContent({ certificate, identity, manualVerificationUrl });
  // 560 px across a ~90 pt square is far beyond office printer resolution, and the quiet zone is the
  // two modules the QR specification asks for.
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: 'png', margin: 2, width: 560 });

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: LEFT, bottom: 0, left: LEFT, right: LEFT },
    info: {
      Title: `${content.title} ${content.invoiceNumber}`,
      Author: content.organisation.issuingAuthority,
      Subject: content.subtitle,
      Keywords: content.invoiceNumber,
      // Pinned to the issue date so downloading the same issued invoice twice produces byte-identical
      // output: a reprint can never be mistaken for a second, different document.
      CreationDate: certificate && certificate.issued_at ? new Date(certificate.issued_at) : new Date(0),
    },
  });

  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.rect(0, 0, PAPER_WIDTH, PAPER_HEIGHT).fill('#FFFFFF');
  // A gold hairline along the top edge is the only ornament the document carries.
  doc.save().fillColor(GOLD).rect(0, 0, PAPER_WIDTH, 4).fill().restore();

  // Issuing header: who issued the invoice, on two lines. Nothing else belongs here.
  // Both lines sit at fixed y positions, so each one is held to a single line: the organisation name
  // shrinks until it fits, and the programme line is clipped. A wrapped line would otherwise print
  // straight over the line underneath it, which is exactly the kind of unreadable header that makes
  // an invoice look forged.
  const headerWidth = 400;
  const organisationSpacing = 1;
  const organisationSize = fitFontSize(doc, content.organisation.name, {
    sizes: [12.5, 12, 11.5, 11, 10.5, 10, 9.5],
    width: headerWidth,
    characterSpacing: organisationSpacing,
  });
  doc.font('Helvetica-Bold').fontSize(organisationSize).fillColor(NAVY).text(content.organisation.name, LEFT, 46, {
    width: headerWidth,
    characterSpacing: organisationSpacing,
    lineBreak: false,
  });
  const identityLine = content.organisation.constituency
    ? `${content.organisation.programme}  |  ${content.organisation.constituency}`
    : content.organisation.programme;
  const identitySize = fitFontSize(doc, identityLine, {
    sizes: [8.6, 8.2, 7.8, 7.4, 7],
    width: headerWidth,
    font: 'Helvetica',
  });
  doc.font('Helvetica').fontSize(identitySize).fillColor(MUTED)
    .text(identityLine, LEFT, 64, { width: headerWidth, height: 10, ellipsis: true });
  hr(doc, 84, { color: NAVY, weight: 1.1 });

  // Document title on the left, the four facts that identify the document on the right. The title
  // stops short of the facts column and the subtitle is clipped, so the two fixed baselines below
  // stay clear of every other element on the page.
  const titleWidth = 288;
  const titleSpacing = 0.7;
  const titleSize = fitFontSize(doc, content.title, {
    sizes: [18, 17, 16, 15, 14, 13],
    width: titleWidth,
    characterSpacing: titleSpacing,
  });
  doc.font('Helvetica-Bold').fontSize(titleSize).fillColor(NAVY_DEEP).text(content.title, LEFT, 98, {
    width: titleWidth,
    characterSpacing: titleSpacing,
    lineBreak: false,
  });
  doc.font('Helvetica').fontSize(8.4).fillColor(MUTED)
    .text(content.subtitle, LEFT, 124, { width: 280, height: 20, lineGap: 1.4, ellipsis: true });

  const metaX = 344;
  const metaWidth = RIGHT - metaX;
  const statusColor = content.status.tone === 'approved' ? TEAL : GOLD_DEEP;
  const metaRows = [
    { label: 'INVOICE NUMBER', value: content.invoiceNumber, bold: true },
    { label: 'ISSUE DATE', value: content.dates.issued },
    { label: 'APPROVAL DATE', value: content.dates.approved },
    { label: 'STATUS', value: content.status.label, color: statusColor, bold: true },
  ];
  let metaY = 96;
  for (const row of metaRows) {
    doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
      .text(row.label, metaX, metaY, { width: metaWidth, align: 'right', characterSpacing: 0.9 });
    doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(row.color || INK)
      .text(String(row.value), metaX, metaY + 9, { width: metaWidth, align: 'right' });
    metaY += 24;
  }

  hr(doc, 192);

  // Billed-to block: the beneficiary's own record, never a sample.
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(GOLD_DEEP)
    .text('BILLED TO', LEFT, 212, { width: 260, characterSpacing: 1.1 });

  const nameWidth = WIDTH;
  let nameSize = 14;
  for (const candidate of [14, 13, 12, 11, 10]) {
    doc.font('Helvetica-Bold').fontSize(candidate);
    if (doc.widthOfString(content.beneficiaryName) <= nameWidth) { nameSize = candidate; break; }
  }
  doc.font('Helvetica-Bold').fontSize(nameSize).fillColor(NAVY_DEEP)
    .text(content.beneficiaryName, LEFT, 226, { width: nameWidth });
  const nameBottom = 226 + doc.heightOfString(content.beneficiaryName, { width: nameWidth });

  let fieldY = nameBottom + 10;
  for (const field of content.beneficiary) {
    doc.font('Helvetica').fontSize(7.2).fillColor(MUTED)
      .text(field.label, LEFT, fieldY, { width: 104, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(field.value, LEFT + 108, fieldY - 0.6, { width: WIDTH - 108 });
    fieldY += 15;
  }

  // One line item, two columns: what was approved, and how much. No quantity column, because the
  // quantity of a bursary award is always one and a column that always prints "1" is noise.
  const tableTop = Math.max(fieldY + 26, 330);
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(MUTED)
    .text('DESCRIPTION', LEFT, tableTop, { width: WIDTH - 140, characterSpacing: 1 })
    .text('AMOUNT (KSh)', RIGHT - 120, tableTop, { width: 120, align: 'right', characterSpacing: 1 });
  hr(doc, tableTop + 13, { color: NAVY, weight: 0.8 });

  let rowY = tableTop + 26;
  for (const item of content.lineItems) {
    doc.font('Helvetica').fontSize(9.4).fillColor(INK);
    const descriptionHeight = doc.heightOfString(item.description, { width: WIDTH - 160, lineGap: 1.4 });
    doc.text(item.description, LEFT, rowY, { width: WIDTH - 160, lineGap: 1.4 });
    doc.text(item.amount, RIGHT - 120, rowY, { width: 120, align: 'right' });
    rowY += Math.max(descriptionHeight, 12) + 10;
  }
  hr(doc, rowY, { color: RULE });

  // The total, once, under the amount column.
  rowY += 14;
  doc.font('Helvetica').fontSize(8.8).fillColor(MUTED)
    .text(content.total.label, RIGHT - 300, rowY, { width: 160, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY_DEEP)
    .text(content.total.value, RIGHT - 120, rowY - 1, { width: 120, align: 'right' });
  const totalBottom = rowY + 16;
  hr(doc, totalBottom, { x: RIGHT - 300, width: 300, color: GOLD, weight: 0.9 });

  // Notes: two actionable lines, printed once. The live verification page carries the detail.
  const bandTop = Math.min(Math.max(totalBottom + 74, 520), 596);
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(GOLD_DEEP)
    .text('NOTES', LEFT, bandTop - 42, { width: 200, characterSpacing: 1.1 });
  doc.font('Helvetica').fontSize(7.8).fillColor(INK)
    .text(content.notes.join('\n'), LEFT, bandTop - 31, { width: WIDTH, lineGap: 2.4, paragraphGap: 3 });

  // Verification band: the code on the left, the readable number and one instruction on the right.
  // Every item sits at a fixed offset inside a full-width band, so no column can wrap into another.
  const bandHeight = 104;
  doc.save().roundedRect(LEFT, bandTop, WIDTH, bandHeight, 4).fillAndStroke(IVORY, RULE).restore();
  const qrSize = 76;
  const qrX = LEFT + 14;
  const qrY = bandTop + 12;
  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font('Helvetica-Bold').fontSize(6.2).fillColor(NAVY)
    .text('SCAN TO VERIFY', qrX, qrY + qrSize + 3, { width: qrSize, align: 'center', characterSpacing: 0.8 });

  const verifyX = qrX + qrSize + 18;
  const verifyWidth = RIGHT - verifyX - 14;
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor(GOLD_DEEP)
    .text('VERIFICATION', verifyX, bandTop + 14, { width: verifyWidth, characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(9.2).fillColor(NAVY_DEEP)
    .text(content.invoiceNumber, verifyX, bandTop + 25, { width: verifyWidth });
  doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
    .text(content.verification.url.replace(/^https?:\/\//, ''), verifyX, bandTop + 39, { width: verifyWidth });
  doc.font('Helvetica').fontSize(7.6).fillColor(INK)
    .text(content.verification.instructions, verifyX, bandTop + 53, { width: verifyWidth, lineGap: 1.8 });

  // A real signatory is printed when the deployment configures one; otherwise the footer already
  // states that the document was issued electronically.
  if (content.signatory) {
    const designation = content.signatory.designation ? `, ${content.signatory.designation}` : '';
    doc.font('Helvetica').fontSize(6.4).fillColor(MUTED)
      .text(`Authorised signatory: ${content.signatory.name}${designation}`, verifyX, bandTop + 76, {
        width: verifyWidth,
      });
  }

  // One footer line: what the document is, and what it is not.
  hr(doc, PAPER_HEIGHT - 52);
  doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
    .text(content.footnote, LEFT, PAPER_HEIGHT - 44, { width: WIDTH, lineGap: 1.4 });

  doc.end();
  return finished;
}

module.exports = { renderInvoicePdf, invoiceContent, money, plainAmount, shortDate };
