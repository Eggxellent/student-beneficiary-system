import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Verification from "./pages/Verification";
import CertificateVerification from "./pages/CertificateVerification";
import Landing from "./pages/Landing";
import Apply from "./pages/Apply";
import TrackApplication from "./pages/TrackApplication";
import Applications from "./pages/Applications";
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
import OfficerApplications from "./pages/officer/OfficerApplications";
import OfficerApplicationDetail from "./pages/officer/OfficerApplicationDetail";
import AwardRecommendations from "./pages/officer/AwardRecommendations";
import { useAuth } from "./context/AuthContext";
import AppLayout from "./components/AppLayout";
import OfficerLayout from "./components/OfficerLayout";


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

  return <Navigate to="/login" replace />;
}

function ProtectedPage({ children, allowedRoles }) {
  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

// The Admin interface keeps the untouched AppLayout. Field Officer pages mount the new shell in
// OfficerLayout; no Admin route is routed through it, so the Admin experience cannot change.
function OfficerPage({ children }) {
  return (
    <ProtectedRoute allowedRoles={["field_officer"]}>
      <OfficerLayout>{children}</OfficerLayout>
    </ProtectedRoute>
  );
}

// `/applications` and `/awards` are shared paths. The Admin branch renders the existing pages inside
// the existing layout, byte-for-byte unchanged; the Field Officer branch renders the redesigned views.
function ApplicationsEntry() {
  const { user } = useAuth();
  if (user?.role === "admin") {
    return (
      <AppLayout>
        <Applications />
      </AppLayout>
    );
  }
  return (
    <OfficerLayout>
      <OfficerApplications />
    </OfficerLayout>
  );
}

function AwardsEntry() {
  const { user } = useAuth();
  if (user?.role === "admin") {
    return (
      <AppLayout>
        <Awards />
      </AppLayout>
    );
  }
  return (
    <OfficerLayout>
      <AwardRecommendations />
    </OfficerLayout>
  );
}


export default function App() {
  return (
    <Routes>
      <Route path="/verify" element={<Verification />} />
      <Route path="/verify-certificate" element={<CertificateVerification />} />
      {/* The guardian workflow is public by design: no account, no session, one tracking code. */}
      <Route path="/apply" element={<Apply />} />
      <Route path="/apply/track" element={<TrackApplication />} />
      {/* One sign-in page for both account types, and one page that spends an administrator's
          one-time reset link. The old role-specific sign-in URLs stay as redirects so bookmarks and
          links in older emails still land on the single form. */}
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
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
        path="/applications"
        element={
          <ProtectedRoute allowedRoles={["admin", "field_officer"]}>
            <ApplicationsEntry />
          </ProtectedRoute>
        }
      />
      <Route
        path="/applications/:id"
        element={
          <OfficerPage>
            <OfficerApplicationDetail />
          </OfficerPage>
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
          <ProtectedRoute allowedRoles={["admin", "field_officer"]}>
            <AwardsEntry />
          </ProtectedRoute>
        }
      />
      <Route
        path="/eligibility"
        element={
          <OfficerPage>
            <Eligibility />
          </OfficerPage>
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
          <OfficerPage>
            <FieldOfficerDashboard />
          </OfficerPage>
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
      {/* The public landing page is the entry point for everyone who is not signed in. It renders
          outside the authenticated layout, and the staff sign-in route is unchanged. */}
      <Route path="/" element={<Landing />} />
    </Routes>
  );
}
