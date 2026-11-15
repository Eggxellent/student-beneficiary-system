const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// A4 PORTRAIT BURSARY APPROVAL INVOICE.
//
// The invoice replaces the landscape certificate as the paper an approved award produces. It is a
// formal accounting-style document: an issuing header, the invoice number and dates on the right, a
// billed-to block holding the beneficiary's own record, a single line item for the approved bursary,
// a totals column, notes about what approval does and does not mean, and a QR block for verification.
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
const NOTE_FILL = '#F6F8F9';

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

function longDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function shortDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
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

  const beneficiary = [
    upi && { label: 'UPI / student no.', value: upi },
    school && { label: 'Institution', value: school },
    period && { label: 'Academic year', value: period },
    identity.constituency && { label: 'Constituency', value: identity.constituency },
  ].filter(Boolean);

  const description = period
    ? `Approved bursary award for the ${period} academic year`
    : 'Approved bursary award';

  return {
    title: 'BURSARY APPROVAL INVOICE',
    subtitle: 'Official record of an approved bursary award',
    documentType: 'Bursary approval invoice',
    organisation: {
      name: 'STUDENT BENEFICIARY MANAGEMENT SYSTEM',
      shortName: 'SBMS',
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
      note: current
        ? 'The award this invoice names is approved in SBMS.'
        : 'The award this invoice names is no longer approved at this amount.',
    },
    dates: {
      issued: shortDate(information.issued_at),
      approved: shortDate(information.award_approved_at),
    },
    approvedOnLong: longDate(information.award_approved_at),
    issuedOnLong: longDate(information.issued_at),
    lineItems: [{
      description,
      quantity: '1',
      amount: amountKnown ? plainAmount(amount) : 'Not recorded',
    }],
    totals: [
      { label: 'Approved bursary amount', value: amountKnown ? money(amount) : 'Not recorded', emphasis: true },
    ],
    paymentTerms: {
      lines: [
        'Approval is not payment.',
        'Payments recorded for this award appear in SBMS and on the verification page, not here.',
      ],
    },
    notes: [
      `Quote invoice number ${information.certificate_reference || '(not recorded)'} in all correspondence.`,
      'Scan the QR code to see the live record: approval status, student details and any payment recorded.',
    ],
    verification: {
      instructions: 'Scan to check this award, its status and any payment recorded in SBMS.',
      reference: information.certificate_reference,
      url: manualVerificationUrl || '',
    },
    signatory: identity.signatory || null,
    footnote: 'Issued electronically by SBMS. Not a tax invoice or a receipt.',
  };
}

// Draws one invoice. The page is measured from fixed anchors so that a long name, institution or
// description cannot push the totals, the notes or the QR code off the sheet and onto page two.
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

  // Issuing header.
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
    .text(content.organisation.name, LEFT, 46, { width: 320, characterSpacing: 1 });
  const identityLine = content.organisation.constituency
    ? `${content.organisation.programme}  |  ${content.organisation.constituency}`
    : content.organisation.programme;
  doc.font('Helvetica').fontSize(8.6).fillColor(MUTED)
    .text(identityLine, LEFT, 65, { width: 320 });
  doc.font('Helvetica').fontSize(7.4).fillColor(MUTED)
    .text('Student beneficiary records  |  Bursary award approvals', LEFT, 78, { width: 320 });
  hr(doc, 96, { color: NAVY, weight: 1.1 });

  // Document title, and the invoice metadata column beside it.
  doc.font('Helvetica-Bold').fontSize(19).fillColor(NAVY_DEEP)
    .text(content.title, LEFT, 112, { width: 300, characterSpacing: 0.7 });
  doc.font('Helvetica').fontSize(8.4).fillColor(MUTED)
    .text(content.subtitle, LEFT, 138, { width: 300, lineGap: 1.4 });

  const metaX = 344;
  const metaWidth = RIGHT - metaX;
  const statusColor = content.status.tone === 'approved' ? TEAL : GOLD_DEEP;
  const metaRows = [
    { label: 'INVOICE NUMBER', value: content.invoiceNumber, bold: true },
    { label: 'ISSUE DATE', value: content.dates.issued },
    { label: 'APPROVAL DATE', value: content.dates.approved },
    { label: 'STATUS', value: content.status.label, color: statusColor, bold: true },
  ];
  let metaY = 110;
  for (const row of metaRows) {
    doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
      .text(row.label, metaX, metaY, { width: metaWidth, align: 'right', characterSpacing: 0.9 });
    doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(row.color || INK)
      .text(String(row.value), metaX, metaY + 9, { width: metaWidth, align: 'right' });
    metaY += 25;
  }

  hr(doc, 216);

  // Billed-to block: the beneficiary's own record, never a sample.
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(GOLD_DEEP)
    .text('BILLED TO  |  BENEFICIARY', LEFT, 228, { width: 260, characterSpacing: 1.1 });

  const nameWidth = 262;
  let nameSize = 13.5;
  for (const candidate of [13.5, 12.5, 11.5, 10.5, 9.5]) {
    doc.font('Helvetica-Bold').fontSize(candidate);
    if (doc.widthOfString(content.beneficiaryName) <= nameWidth) { nameSize = candidate; break; }
  }
  doc.font('Helvetica-Bold').fontSize(nameSize).fillColor(NAVY_DEEP)
    .text(content.beneficiaryName, LEFT, 242, { width: nameWidth });
  const nameBottom = 242 + doc.heightOfString(content.beneficiaryName, { width: nameWidth });

  let fieldY = nameBottom + 12;
  for (const field of content.beneficiary) {
    doc.font('Helvetica').fontSize(7.2).fillColor(MUTED)
      .text(field.label, LEFT, fieldY, { width: 104, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(field.value, LEFT + 108, fieldY - 0.6, { width: nameWidth - 108 });
    fieldY += 15;
  }

  // The approved amount is the figure a reader looks for first, so it gets its own panel.
  const boxX = 348;
  const boxWidth = RIGHT - boxX;
  const boxTop = 228;
  const boxHeight = 88;
  doc.save().roundedRect(boxX, boxTop, boxWidth, boxHeight, 4).fillAndStroke(IVORY, RULE).restore();
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor(GOLD_DEEP)
    .text('APPROVED BURSARY AMOUNT', boxX + 14, boxTop + 14, { width: boxWidth - 28, characterSpacing: 0.9 });
  // Shrink a long amount rather than letting it wrap over the line beneath it.
  const amountValue = content.totals[0].value;
  let amountSize = 18;
  for (const candidate of [18, 16, 14.5, 13, 11.5, 10]) {
    doc.font('Helvetica-Bold').fontSize(candidate);
    if (doc.widthOfString(amountValue) <= boxWidth - 28) { amountSize = candidate; break; }
  }
  doc.font('Helvetica-Bold').fontSize(amountSize).fillColor(NAVY_DEEP)
    .text(amountValue, boxX + 14, boxTop + 26, { width: boxWidth - 28 });
  doc.font('Helvetica').fontSize(7.6).fillColor(MUTED)
    .text(`Approved ${content.dates.approved}`, boxX + 14, boxTop + 52, { width: boxWidth - 28 });
  // Line item table.
  const tableTop = Math.max(fieldY + 22, 356);
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(MUTED)
    .text('DESCRIPTION', LEFT, tableTop, { width: WIDTH - 150, characterSpacing: 1 })
    .text('QTY', RIGHT - 132, tableTop, { width: 42, align: 'right', characterSpacing: 1 })
    .text('AMOUNT (KSh)', RIGHT - 82, tableTop, { width: 82, align: 'right', characterSpacing: 1 });
  hr(doc, tableTop + 13, { color: NAVY, weight: 0.8 });

  let rowY = tableTop + 24;
  for (const item of content.lineItems) {
    doc.font('Helvetica').fontSize(9.4).fillColor(INK);
    const descriptionHeight = doc.heightOfString(item.description, { width: WIDTH - 160, lineGap: 1.4 });
    doc.text(item.description, LEFT, rowY, { width: WIDTH - 160, lineGap: 1.4 });
    doc.text(item.quantity, RIGHT - 132, rowY, { width: 42, align: 'right' });
    doc.text(item.amount, RIGHT - 82, rowY, { width: 82, align: 'right' });
    rowY += Math.max(descriptionHeight, 12) + 12;
  }
  hr(doc, rowY, { color: RULE });

  // Totals, right aligned under the amount column.
  const totalsLabelX = RIGHT - 260;
  rowY += 12;
  for (const row of content.totals) {
    const font = row.emphasis ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(font).fontSize(row.emphasis ? 10 : 8.8)
      .fillColor(row.emphasis ? NAVY_DEEP : MUTED)
      .text(row.label, totalsLabelX, rowY, { width: 148, align: 'right' });
    doc.font(font).fontSize(row.emphasis ? 10 : 8.8)
      .fillColor(row.emphasis ? NAVY_DEEP : INK)
      .text(row.value, RIGHT - 104, rowY, { width: 104, align: 'right' });
    rowY += row.emphasis ? 18 : 15;
  }
  hr(doc, rowY + 2, { x: totalsLabelX, width: RIGHT - totalsLabelX, color: GOLD, weight: 0.9 });

  // Notes and payment terms share the left column; the QR verification block takes the right one.
  const bandTop = Math.min(Math.max(rowY + 32, 520), 566);
  const notesWidth = 258;
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(GOLD_DEEP)
    .text('NOTES', LEFT, bandTop, { width: notesWidth, characterSpacing: 1.1 });
  doc.font('Helvetica').fontSize(7.8).fillColor(INK)
    .text(content.notes.join('\n'), LEFT, bandTop + 11, { width: notesWidth, lineGap: 2.4, paragraphGap: 3 });

  const termsTop = bandTop + 84;
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(GOLD_DEEP)
    .text('PAYMENT TERMS', LEFT, termsTop, { width: notesWidth, characterSpacing: 1.1 });
  doc.font('Helvetica').fontSize(7.6).fillColor(MUTED)
    .text(content.paymentTerms.lines.join('\n'), LEFT, termsTop + 11, {
      width: notesWidth, lineGap: 2.2, paragraphGap: 2.6,
    });

  // QR block: the code carries the opaque verification token, the paper carries the readable number.
  const verifyX = 344;
  const verifyWidth = RIGHT - verifyX;
  const qrSize = 86;
  doc.save().roundedRect(verifyX, bandTop - 8, verifyWidth, 150, 4).fillAndStroke('#FFFFFF', RULE).restore();
  doc.image(qrPng, verifyX + 12, bandTop + 2, { width: qrSize, height: qrSize });
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor(NAVY)
    .text('SCAN TO VERIFY', verifyX + 12, bandTop + 92, { width: qrSize, align: 'center', characterSpacing: 0.8 });
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor(GOLD_DEEP)
    .text('VERIFICATION', verifyX + 108, bandTop + 2, { width: verifyWidth - 120, characterSpacing: 1 });
  doc.font('Helvetica').fontSize(7.2).fillColor(INK)
    .text(content.verification.instructions, verifyX + 108, bandTop + 13, {
      width: verifyWidth - 122, lineGap: 1.8,
    });
  doc.font('Helvetica-Bold').fontSize(7.4).fillColor(NAVY_DEEP)
    .text(content.invoiceNumber, verifyX + 108, bandTop + 66, { width: verifyWidth - 120 });
  doc.font('Helvetica').fontSize(6.4).fillColor(MUTED)
    .text(content.verification.url.replace(/^https?:\/\//, ''), verifyX + 108, bandTop + 77, {
      width: verifyWidth - 120,
    });

  // A real signatory is printed when the deployment configures one; otherwise the footer already
  // states that the document was issued electronically.
  if (content.signatory) {
    const designation = content.signatory.designation ? `, ${content.signatory.designation}` : '';
    doc.font('Helvetica').fontSize(6.2).fillColor(MUTED)
      .text(`Authorised signatory: ${content.signatory.name}${designation}`, verifyX + 12, bandTop + 106, {
        width: verifyWidth - 24, lineGap: 1.2,
      });
  }

  hr(doc, PAPER_HEIGHT - 52);
  doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
    .text(content.footnote, LEFT, PAPER_HEIGHT - 44, { width: WIDTH - 90, lineGap: 1.4 });
  doc.font('Helvetica-Bold').fontSize(7).fillColor(NAVY)
    .text(`${content.organisation.shortName}  |  ${content.invoiceNumber}`, RIGHT - 90, PAPER_HEIGHT - 40, {
      width: 90, align: 'right',
    });

  doc.end();
  return finished;
}

module.exports = { renderInvoicePdf, invoiceContent, money, plainAmount, longDate, shortDate };
