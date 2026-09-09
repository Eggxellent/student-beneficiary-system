import { useState } from "react";

function calculateEligibility({
  fee_balance,
  household_income,
  vulnerability_status,
  siblings_in_school,
  prior_bursary_history,
}) {
  let score = 0;

  if (fee_balance >= 50000) score += 30;
  else if (fee_balance >= 30000) score += 25;
  else if (fee_balance >= 15000) score += 15;
  else if (fee_balance > 0) score += 5;

  if (household_income <= 20000) score += 25;
  else if (household_income <= 40000) score += 20;
  else if (household_income <= 60000) score += 10;

  if (vulnerability_status === "high") score += 25;
  else if (vulnerability_status === "medium") score += 15;
  else if (vulnerability_status === "low") score += 5;

  if (siblings_in_school >= 4) score += 10;
  else if (siblings_in_school >= 2) score += 7;
  else if (siblings_in_school === 1) score += 3;

  if (prior_bursary_history === "none") score += 10;
  else if (prior_bursary_history === "low") score += 7;
  else if (prior_bursary_history === "high") score += 2;

  let category;

  if (score >= 75) category = "Highly Eligible";
  else if (score >= 50) category = "Eligible";
  else if (score >= 30) category = "Partially Eligible";
  else category = "Not Eligible";

  return { score, category };
}

export default function Eligibility() {
  const [form, setForm] = useState({
    fee_balance: "",
    household_income: "",
    vulnerability_status: "low",
    siblings_in_school: 0,
    prior_bursary_history: "none",
  });
  const [result, setResult] = useState(null);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setResult(calculateEligibility({
      fee_balance: Number(form.fee_balance),
      household_income: Number(form.household_income),
      vulnerability_status: form.vulnerability_status,
      siblings_in_school: Number(form.siblings_in_school),
      prior_bursary_history: form.prior_bursary_history,
    }));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Eligibility Assessment</h1>
      <p className="text-gray-600 mb-6">Calculate a student's bursary eligibility score.</p>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow">
        <label className="block font-medium mb-2">Fee Balance (KSh)</label>
        <input type="number" min="0" name="fee_balance" value={form.fee_balance} onChange={handleChange} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">Household Income (KSh)</label>
        <input type="number" min="0" name="household_income" value={form.household_income} onChange={handleChange} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">Vulnerability Status</label>
        <select name="vulnerability_status" value={form.vulnerability_status} onChange={handleChange} className="w-full border rounded p-3 mb-5">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>

        <label className="block font-medium mb-2">Siblings Currently in School</label>
        <input type="number" min="0" name="siblings_in_school" value={form.siblings_in_school} onChange={handleChange} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">Prior Bursary History</label>
        <select name="prior_bursary_history" value={form.prior_bursary_history} onChange={handleChange} className="w-full border rounded p-3 mb-6">
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="high">High</option>
        </select>

        <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700">Calculate Eligibility</button>
      </form>

      {result && (
        <div className="mt-6 bg-white p-6 rounded-lg shadow text-center">
          <p className="text-gray-600">Eligibility Score</p>
          <p className="text-5xl font-bold my-3">{result.score}/100</p>
          <p className="text-xl font-semibold">{result.category}</p>
        </div>
      )}
    </div>
  );
}
