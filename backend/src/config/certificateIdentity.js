// WHO THE CERTIFICATE SAYS IT COMES FROM.
//
// Nothing here is invented. SBMS has no constituency, logo, crest or signatory in its database, and
// a certificate must never imply an authority that did not issue it. So the printed identity is:
//
//   - the programme name, which is the one thing the system does know it is administering;
//   - an optional constituency name, printed only when an operator configures the deployment;
//   - an optional signatory, printed only when an operator supplies a real name and designation.
//
// When the optional values are unset the corresponding block is omitted rather than filled with a
// placeholder, so an unconfigured deployment produces an honest typographic certificate instead of
// a forged-looking one.
const DEFAULT_PROGRAMME = 'NG-CDF bursary programme';
const ISSUING_AUTHORITY = 'Student Beneficiary Management System (SBMS)';

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function getCertificateIdentity(env = process.env) {
  const programme = clean(env.SBMS_BURSARY_PROGRAMME, 120) || DEFAULT_PROGRAMME;
  const constituency = clean(env.SBMS_CONSTITUENCY, 120);
  const signatoryName = clean(env.SBMS_SIGNATORY_NAME, 120);
  const signatoryDesignation = clean(env.SBMS_SIGNATORY_TITLE, 120);

  return {
    programme,
    constituency: constituency || null,
    // A name without a designation is still a name; a designation without a name is decoration.
    signatory: signatoryName
      ? { name: signatoryName, designation: signatoryDesignation || null }
      : null,
    issuingAuthority: ISSUING_AUTHORITY,
  };
}

module.exports = { DEFAULT_PROGRAMME, ISSUING_AUTHORITY, getCertificateIdentity };
