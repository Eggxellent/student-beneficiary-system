const rawAcknowledgementDays = (process.env.ACKNOWLEDGEMENT_OVERDUE_DAYS || '').trim();

let acknowledgementOverdueDays = null;
if (rawAcknowledgementDays) {
  const parsedDays = Number(rawAcknowledgementDays);
  if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 3650) {
    throw new Error('ACKNOWLEDGEMENT_OVERDUE_DAYS must be an integer from 1 to 3650');
  }
  acknowledgementOverdueDays = parsedDays;
}

module.exports = { acknowledgementOverdueDays };
