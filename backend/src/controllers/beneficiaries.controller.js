const Beneficiary = require('../models/beneficiary.model');

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
  res.status(201).json(beneficiary);
}

async function update(req, res) {
  const beneficiary = await Beneficiary.update(req.params.id, req.body);
  if (!beneficiary) return res.status(404).json({ error: 'Not found' });
  res.json(beneficiary);
}

async function remove(req, res) {
  const beneficiary = await Beneficiary.remove(req.params.id);
  if (!beneficiary) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
}

module.exports = { list, get, create, update, remove };
