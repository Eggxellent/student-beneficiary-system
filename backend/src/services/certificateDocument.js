const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Layout constants: A4 landscape, a double rule inside the paper edge, and one column of award
// facts beside the QR code. Colours match the palette in `frontend/src/index.css`, so a printed
// certificate looks like it came from the application it came from.
const FOREST = '#173D35';
const GOLD = '#C8A45D';
const MUTED = '#53615A';
const PAPER_WIDTH = 841.89;
const PAPER_HEIGHT = 595.28;
const EDGE = 24;

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  return `KSh ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function longDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function drawPageBorder(doc) {
  doc.save();
  doc.lineWidth(2).strokeColor(GOLD)
    .rect(EDGE, EDGE, PAPER_WIDTH - EDGE * 2, PAPER_HEIGHT - EDGE * 2).stroke();
  doc.lineWidth(0.6).strokeColor(FOREST)
    .rect(EDGE + 6, EDGE + 6, PAPER_WIDTH - (EDGE + 6) * 2, PAPER_HEIGHT - (EDGE + 6) * 2).stroke();
  doc.restore();
}

function drawFacts(doc, rows, { x, y, width, labelWidth }) {
  let cursor = y;
  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(label.toUpperCase(), x, cursor, { width: labelWidth, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(FOREST)
      .text(value, x + labelWidth, cursor - 1, { width: width - labelWidth });
    cursor += 26;
  }
  return cursor;
}

// Renders the certificate to a Buffer. A Buffer (rather than a live stream) keeps the response
// atomic: a rendering failure becomes a JSON error instead of a truncated PDF download.
async function renderCertificatePdf({ certificate, verificationUrl }) {
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: 'png', margin: 1, width: 640 });
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE },
    info: {
      Title: `SBMS Bursary Award Certificate ${certificate.certificate_reference}`,
      Author: 'Student Beneficiary Management System (SBMS)',
      Subject: 'Certificate of an approved bursary award',
      Keywords: certificate.certificate_reference,
    },
  });

  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const contentX = EDGE + 40;
  const contentWidth = PAPER_WIDTH - contentX * 2;

  drawPageBorder(doc);

  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text('STUDENT BENEFICIARY MANAGEMENT SYSTEM (SBMS)', contentX, 58, {
      width: contentWidth, align: 'center', characterSpacing: 2,
    });
  doc.font('Helvetica-Bold').fontSize(27).fillColor(FOREST)
    .text('Bursary Award Certificate', contentX, 76, { width: contentWidth, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text('Certificate of authenticity for an approved bursary award', contentX, 112, {
      width: contentWidth, align: 'center',
    });

  doc.save().lineWidth(0.8).strokeColor(GOLD)
    .moveTo(PAPER_WIDTH / 2 - 90, 136).lineTo(PAPER_WIDTH / 2 + 90, 136).stroke().restore();

  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text('This certificate confirms that the following bursary award was approved in SBMS.', contentX, 152, {
      width: contentWidth,
    });
  doc.font('Helvetica-Bold').fontSize(19).fillColor(FOREST)
    .text(certificate.student_name, contentX, 170, { width: contentWidth });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
    .text(
      [
        certificate.student_upi ? `UPI ${certificate.student_upi}` : null,
        certificate.school_code ? `School: ${certificate.school_code}` : null,
      ].filter(Boolean).join('   |   ') || 'Student record on file',
      contentX,
      196,
      { width: contentWidth }
    );

  const factsX = contentX;
  const factsWidth = 430;
  const qrSize = 132;
  const qrX = PAPER_WIDTH - contentX - qrSize;
  const factsY = 240;

  doc.save().lineWidth(0.5).strokeColor('#DFE6E1')
    .moveTo(contentX, factsY - 14).lineTo(contentX + contentWidth, factsY - 14).stroke().restore();

  drawFacts(doc, [
    ['Certificate reference', certificate.certificate_reference],
    ['Award period', certificate.award_period],
    ['Approved amount', money(certificate.approved_amount)],
    ['Award approved on', longDate(certificate.award_approved_at)],
    ['Date issued', longDate(certificate.issued_at)],
    ['Issued by', certificate.issued_by_name],
  ], { x: factsX, y: factsY, width: factsWidth, labelWidth: 150 });

  doc.image(qrPng, qrX, factsY - 2, { width: qrSize, height: qrSize });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(FOREST)
    .text('SCAN TO VERIFY', qrX, factsY + qrSize + 8, { width: qrSize, align: 'center', characterSpacing: 1 });
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(verificationUrl, qrX - 24, factsY + qrSize + 22, { width: qrSize + 48, align: 'center' });

  doc.save().lineWidth(0.5).strokeColor('#DFE6E1')
    .moveTo(contentX, 432).lineTo(contentX + contentWidth, 432).stroke().restore();

  doc.font('Helvetica-Bold').fontSize(9).fillColor(FOREST)
    .text('APPROVAL IS NOT PAYMENT', contentX, 444, { width: contentWidth, characterSpacing: 0.6 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(
      'This certificate proves that SBMS approved the bursary award named above. It does not confirm '
      + 'or record any payment; SBMS records bursary decisions only.',
      contentX,
      458,
      { width: contentWidth, align: 'justify', lineGap: 1.5 }
    );

  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(
      `Authenticity can be confirmed at ${verificationUrl} by scanning the QR code above. `
      + 'The result is answered live from the SBMS database, so a reprinted copy or a manually '
      + 'generated QR code cannot pass verification.',
      contentX,
      498,
      { width: contentWidth, lineGap: 1 }
    );
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(
      'Electronically issued by SBMS. No handwritten signature or institutional seal is required for '
      + 'this certificate to be valid.',
      contentX,
      532,
      { width: contentWidth }
    );

  doc.end();
  return finished;
}

module.exports = { renderCertificatePdf, money, longDate };
