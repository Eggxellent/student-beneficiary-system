import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Verification from "./pages/Verification";
import CertificateVerification from "./pages/CertificateVerification";
import AdminDashboard from "./pages/AdminDashboard";
import Students from "./pages/Students";
import StudentRegistration from "./pages/StudentRegistration";
import DuplicateReview from "./pages/DuplicateReview";
import Awards from "./pages/Awards";
import Eligibility from "./pages/Eligibility";
import FieldOfficerDashboard from "./pages/FieldOfficerDashboard";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import AuditLogs from "./pages/AuditLogs";
import UserManagement from "./pages/UserManagement";
import GuardianRegistration from "./pages/GuardianRegistration";
import GuardianDashboard from "./pages/GuardianDashboard";
import NewApplication from "./pages/NewApplication";
import MyApplications from "./pages/MyApplications";
import ApplicationDetails from "./pages/ApplicationDetails";
import GuardianAccount from "./pages/GuardianAccount";
import { useAuth } from "./context/AuthContext";
import AppLayout from "./components/AppLayout";

function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, user, authLoading } = useAuth();

  if (authLoading) return null;

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
    return <AdminDashboard />;
  }

  if (user?.role === "field_officer") {
    return <Navigate to="/field-officer" replace />;
  }

  if (user?.role === "guardian") {
    return <Navigate to="/guardian/dashboard" replace />;
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
      <Route path="/verify" element={<Verification />} />
      <Route path="/verify-certificate" element={<CertificateVerification />} />
      {/* One sign-in page for both account types, and one page that spends an administrator's
          one-time reset link. The old role-specific sign-in URLs stay as redirects so bookmarks and
          links in older emails still land on the single form. */}
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Guardian self-registration stays public; it links to the shared /login form. The guardian
          workspace below requires a signed-in guardian account, and a guardian token is rejected by
          every staff route and vice versa. */}
      <Route path="/guardian/register" element={<GuardianRegistration />} />
      <Route
        path="/guardian/dashboard"
        element={<ProtectedRoute allowedRoles={["guardian"]}><GuardianDashboard /></ProtectedRoute>}
      />
      <Route
        path="/guardian/applications/new"
        element={<ProtectedRoute allowedRoles={["guardian"]}><NewApplication /></ProtectedRoute>}
      />
      <Route
        path="/guardian/applications"
        element={<ProtectedRoute allowedRoles={["guardian"]}><MyApplications /></ProtectedRoute>}
      />
      {/* React Router ranks the static /guardian/applications/new route above this dynamic one. */}
      <Route
        path="/guardian/applications/:reference"
        element={<ProtectedRoute allowedRoles={["guardian"]}><ApplicationDetails /></ProtectedRoute>}
      />
      <Route
        path="/guardian/profile"
        element={<ProtectedRoute allowedRoles={["guardian"]}><GuardianAccount /></ProtectedRoute>}
      />
      <Route path="/admin/login" element={<Navigate to="/login" replace />} />
      <Route path="/field-officer/login" element={<Navigate to="/login" replace />} />
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
        path="/awards"
        element={
          <ProtectedPage allowedRoles={["admin", "field_officer"]}>
            <Awards />
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
      <Route path="/users" element={<ProtectedPage allowedRoles={["admin"]}><UserManagement /></ProtectedPage>} />
      <Route
        path="/field-officer"
        element={
          <ProtectedPage allowedRoles={["field_officer"]}>
            <FieldOfficerDashboard />
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
      {/* The sign-in screen is the entry point; the marketing page is retired so nobody has to
          click through it before reaching the staff login form. */}
      <Route path="/" element={<Navigate to="/login" replace />} />

    </Routes>
  );
}
