import { useState } from "react";
import api from "../services/api";

export default function StudentRegistration() {
  const [form, setForm] = useState({
    full_name: "",
    date_of_birth: "",
    school_code: "",
    guardian_id: "",
    upi: "",
    birth_certificate_number: "",
  });

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await api.post("/students", form);

      setResult(response.data);

      setForm({
        full_name: "",
        date_of_birth: "",
        school_code: "",
        guardian_id: "",
        upi: "",
        birth_certificate_number: "",
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Failed to register student."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-2">
        Register Student
      </h1>

      <p className="text-gray-600 mb-6">
        Enter the student's details as provided. Possible duplicates are routed to an administrator for review.
      </p>

      {error && (
        <div className="mb-6 p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="mb-6 p-5 bg-green-50 border border-green-200 rounded text-green-800">
          <h2 className="text-xl font-bold mb-2">Student registered</h2>
          <p>{result.message}</p>

          {result.qr_code && (
            <div className="mt-5">
              <p className="font-medium mb-2">
                Student QR Code
              </p>

              <img
                src={result.qr_code}
                alt="Student QR Code"
                className="w-40 h-40 border"
              />
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white p-6 rounded-lg shadow"
      >
        <label className="block font-medium mb-2">
          Full Name
        </label>
        <p className="text-sm text-gray-500 mb-2">Use the student's full name as shown on official records.</p>

        <input
          name="full_name"
          value={form.full_name}
          onChange={handleChange}
          className="w-full border rounded p-3 mb-5"
          placeholder="e.g. John Kamau"
          required
        />

        <label className="block font-medium mb-2">
          Date of Birth
        </label>
        <p className="text-sm text-gray-500 mb-2">Format: YYYY-MM-DD.</p>

        <input
          type="date"
          name="date_of_birth"
          value={form.date_of_birth}
          onChange={handleChange}
          className="w-full border rounded p-3 mb-5"
        />

        <label className="block font-medium mb-2">
          School Code
        </label>
        <p className="text-sm text-gray-500 mb-2">Use the official school code, e.g. SCH001 or SCH-001.</p>

        <input
          name="school_code"
          value={form.school_code}
          onChange={handleChange}
          className="w-full border rounded p-3 mb-5"
          placeholder="e.g. SCH001"
        />

        <label className="block font-medium mb-2">
          Guardian ID
        </label>
        <p className="text-sm text-gray-500 mb-2">Use the assigned ID, e.g. G001 or G-123456.</p>

        <input
          name="guardian_id"
          value={form.guardian_id}
          onChange={handleChange}
          className="w-full border rounded p-3 mb-6"
          placeholder="e.g. G001"
        />

        <label className="block font-medium mb-2">
          UPI
        </label>
        <p className="text-sm text-gray-500 mb-2">Use the student's official UPI, e.g. UPI-12345678.</p>

        <input
          name="upi"
          value={form.upi}
          onChange={handleChange}
          className="w-full border rounded p-3 mb-6"
          placeholder="e.g. UPI-12345678"
          required
        />

        <label className="block font-medium mb-2">
          Birth Certificate Number
        </label>
        <p className="text-sm text-gray-500 mb-2">Enter the number as printed, e.g. BC-1001.</p>

        <input
          name="birth_certificate_number"
          value={form.birth_certificate_number}
          onChange={handleChange}
          className="w-full border rounded p-3 mb-6"
          placeholder="e.g. BC-1001"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Registering..." : "Register Student"}
        </button>
      </form>
    </div>
  );
}
