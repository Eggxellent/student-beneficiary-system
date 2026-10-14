import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Students from "./pages/Students";
import StudentRegistration from "./pages/StudentRegistration";
import DuplicateReview from "./pages/DuplicateReview";
import Disbursements from "./pages/Disbursements";
import Eligibility from "./pages/Eligibility";
import FieldOfficerDashboard from "./pages/FieldOfficerDashboard";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import AuditLogs from "./pages/AuditLogs";
import { useAuth } from "./context/AuthContext";
import AppLayout from "./components/AppLayout";

function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function DashboardHome() {
  const { user } = useAuth();

  if (user?.role === "admin") {
    return <Navigate to="/duplicate-review" replace />;
  }

  if (user?.role === "field_officer") {
    return <AppLayout><FieldOfficerDashboard /></AppLayout>;
  }

  return <Navigate to="/login" replace />;
}

function ProtectedPage({ children, allowedRoles }) {
  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/students"
        element={
          <ProtectedPage allowedRoles={["field_officer"]}>
            <Students />
          </ProtectedPage>
        }
      />
      <Route
        path="/students/register"
        element={
          <ProtectedPage allowedRoles={["field_officer"]}>
            <StudentRegistration />
          </ProtectedPage>
        }
      />
      <Route
        path="/duplicate-review"
        element={
          <ProtectedPage allowedRoles={["admin"]}>
            <DuplicateReview />
          </ProtectedPage>
        }
      />
      <Route
        path="/disbursements"
        element={
          <ProtectedPage allowedRoles={["field_officer"]}>
            <Disbursements />
          </ProtectedPage>
        }
      />
      <Route
        path="/eligibility"
        element={
          <ProtectedPage allowedRoles={["field_officer"]}>
            <Eligibility />
          </ProtectedPage>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedPage allowedRoles={["admin"]}>
            <Reports />
          </ProtectedPage>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedPage allowedRoles={["admin"]}>
            <Settings />
          </ProtectedPage>
        }
      />
      <Route
        path="/audit"
        element={
          <ProtectedPage allowedRoles={["admin"]}>
            <AuditLogs />
          </ProtectedPage>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardHome />
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
