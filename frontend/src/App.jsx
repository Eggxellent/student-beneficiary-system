import { Link, Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Students from "./pages/Students";
import StudentRegistration from "./pages/StudentRegistration";
import DuplicateReview from "./pages/DuplicateReview";
import Disbursements from "./pages/Disbursements";
import Eligibility from "./pages/Eligibility";
import AdminDashboard from "./pages/AdminDashboard";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import { useAuth } from "./context/AuthContext";

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">SBMS Dashboard</h1>
      <p className="mt-2">Welcome, {user?.full_name}</p>
      <p className="text-gray-600">Role: {user?.role}</p>
      <Link
        to="/students/register"
        className="inline-block mt-6 bg-blue-600 text-white px-5 py-3 rounded"
      >
        Register Student
      </Link>
      <Link
        to="/duplicate-review"
        className="inline-block mt-6 ml-3 bg-amber-600 text-white px-5 py-3 rounded"
      >
        Duplicate Review
      </Link>
      <Link
        to="/disbursements"
        className="inline-block mt-6 ml-3 bg-green-600 text-white px-5 py-3 rounded"
      >
        Disbursements
      </Link>
      <Link
        to="/eligibility"
        className="inline-block mt-6 ml-3 bg-purple-600 text-white px-5 py-3 rounded"
      >
        Eligibility
      </Link>
      <Link
        to="/reports"
        className="inline-block mt-6 ml-3 bg-slate-700 text-white px-5 py-3 rounded"
      >
        Reports
      </Link>
      <button
        onClick={logout}
        className="mt-6 bg-red-600 text-white px-4 py-2 rounded"
      >
        Logout
      </button>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/students"
        element={
          <ProtectedRoute>
            <Students />
          </ProtectedRoute>
        }
      />
      <Route
        path="/students/register"
        element={
          <ProtectedRoute>
            <StudentRegistration />
          </ProtectedRoute>
        }
      />
      <Route
        path="/duplicate-review"
        element={
          <ProtectedRoute>
            <DuplicateReview />
          </ProtectedRoute>
        }
      />
      <Route
        path="/disbursements"
        element={
          <ProtectedRoute>
            <Disbursements />
          </ProtectedRoute>
        }
      />
      <Route
        path="/eligibility"
        element={
          <ProtectedRoute>
            <Eligibility />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <Reports />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Navigate to="/dashboard" replace />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
