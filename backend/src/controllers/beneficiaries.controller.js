const Beneficiary = require('../models/beneficiary.model');
const Audit = require('../models/audit.model');

async function audit(userId, action, beneficiaryId) {
  try {
    await Audit.create({
      user_id: userId,
      action: `${action}:${beneficiaryId}`,
      table_name: 'beneficiaries',
    });
  } catch (error) {
    console.error('Audit log failed:', error.message);
  }
}

async function list(req, res) {
  const beneficiaries = await Beneficiary.getAll();
  res.json(beneficiaries);
}

async function get(req, res) {
  const beneficiary = await Beneficiary.getById(req.params.id);
  if (!beneficiary) return res.status(404).json({ error: 'Not found' });
  res.json(beneficiary);
}

async function create(req, res) {
  const beneficiary = await Beneficiary.create(req.body);
  await audit(req.user.id || req.user.sub, 'CREATE', beneficiary.id);
  res.status(201).json(beneficiary);
}

async function update(req, res) {
  const beneficiary = await Beneficiary.update(req.params.id, req.body);
  if (!beneficiary) return res.status(404).json({ error: 'Not found' });
  await audit(req.user.id || req.user.sub, 'UPDATE', beneficiary.id);
  res.json(beneficiary);
}

async function remove(req, res) {
  const beneficiary = await Beneficiary.remove(req.params.id);
  if (!beneficiary) return res.status(404).json({ error: 'Not found' });
  await audit(req.user.id || req.user.sub, 'DELETE', beneficiary.id);
  res.status(204).send();
}

module.exports = { list, get, create, update, remove };
