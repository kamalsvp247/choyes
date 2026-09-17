import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { AccessAuthProvider } from "@/contexts/AccessAuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AccessProtectedRoute from "@/components/AccessProtectedRoute";
import { SpeedInsights } from "@vercel/speed-insights/react";
import LoginPage from "@/pages/auth/LoginPage";
import OtpPage from "@/pages/auth/OtpPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import DashboardPage from "@/pages/DashboardPage";
import BookingPage from "@/pages/exam/BookingPage";
import PaymentPage from "@/pages/exam/PaymentPage";
import PaymentResultPage from "@/pages/exam/PaymentResultPage";
import ReservationsPage from "@/pages/exam/ReservationsPage";
import PaymentHistoryPage from "@/pages/exam/PaymentHistoryPage";
import ExamSessionListPage from "@/pages/exam/ExamSessionListPage";
import ExamSessionDetailPage from "@/pages/exam/ExamSessionDetailPage";
import AccessLoginPage from "@/pages/access/AccessLoginPage";
import AccessRegisterPage from "@/pages/access/AccessRegisterPage";
import AccessForbiddenPage from "@/pages/access/AccessForbiddenPage";
import AccessFinancePage from "@/pages/access/AccessFinancePage";
import AccessNoticePage from "@/pages/access/AccessNoticePage";
import WalletPage from "@/pages/WalletPage";
import ForgotPasswordPage from "@/pages/access/ForgotPasswordPage";
import AccessDashboardPage from "@/pages/access/AccessDashboardPage";
import AccessAccountsPage from "@/pages/access/AccessAccountsPage";
import AccessUsersPage from "@/pages/access/AccessUsersPage";
import AccessAgenciesPage from "@/pages/access/AccessAgenciesPage";
import AccessSessionCentersPage from "@/pages/access/AccessSessionCentersPage";
import AccessTestCentersPage from "@/pages/access/AccessTestCentersPage";
import AccessSectionRulesPage from "@/pages/access/AccessSectionRulesPage";
import ResultVerificationPage from "@/pages/access/ResultVerificationPage";
import TestCenterDetailPage from "@/pages/exam/TestCenterDetailPage";
import NotFound from "@/pages/NotFound";
import { TakamolAuthProvider } from "@/contexts/TakamolAuthContext";
import TakamolLayout from "@/pages/takamol/TakamolLayout";
import TakamolLoginPage from "@/pages/takamol/TakamolLoginPage";
import TakamolDashboardPage from "@/pages/takamol/TakamolDashboardPage";
import TakamolBookingPage from "@/pages/takamol/TakamolBookingPage";
import TakamolReservationsPage from "@/pages/takamol/TakamolReservationsPage";
import TakamolSessionsPage from "@/pages/takamol/TakamolSessionsPage";
import TakamolResultsPage from "@/pages/takamol/TakamolResultsPage";
import T2HubLivePage from "@/pages/takamol/T2HubLivePage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <AccessAuthProvider>
        <TakamolAuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <SpeedInsights />
            <BrowserRouter>
              <Routes>
                {/* SVP Auth */}
                <Route path="/" element={<Navigate to="/access/login" replace />} />
              <Route path="/auth/login" element={<LoginPage />} />
              <Route path="/auth/otp" element={<AccessProtectedRoute allowedRoles={["USER"]}><OtpPage /></AccessProtectedRoute>} />
              <Route path="/auth/register" element={<RegisterPage />} />
              <Route path="/user" element={<Navigate to="/auth/login" replace />} />
              <Route path="/dashboard" element={<AccessProtectedRoute allowedRoles={["USER"]}><DashboardPage /></AccessProtectedRoute>} />
              <Route path="/exam/booking" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="booking.create"><ProtectedRoute><BookingPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/booking" element={<Navigate to="/exam/booking" replace />} />
              <Route path="/exam/payment" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="payment.create"><ProtectedRoute><PaymentPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/exam/payment/result" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="payment.create"><ProtectedRoute><PaymentResultPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/exam/reservations" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="reservation.manage"><ProtectedRoute><ReservationsPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/exam/payments" element={<AccessProtectedRoute allowedRoles={["USER"]}><ProtectedRoute><PaymentHistoryPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/exam/sessions" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="reservation.manage"><ProtectedRoute><ExamSessionListPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/exam/sessions/:id" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="reservation.manage"><ProtectedRoute><ExamSessionDetailPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/wallet" element={<AccessProtectedRoute allowedRoles={["USER"]}><ProtectedRoute><WalletPage /></ProtectedRoute></AccessProtectedRoute>} />
              <Route path="/exam/test-centers/:id" element={<ProtectedRoute><TestCenterDetailPage /></ProtectedRoute>} />

              {/* Access Control System */}
              <Route path="/access/login" element={<AccessLoginPage />} />
              <Route path="/access/register" element={<AccessRegisterPage />} />
              <Route path="/access/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/access/forbidden" element={<AccessProtectedRoute><AccessForbiddenPage /></AccessProtectedRoute>} />
              <Route path="/access/dashboard" element={<AccessProtectedRoute><AccessDashboardPage /></AccessProtectedRoute>} />
              <Route path="/access/accounts" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessAccountsPage /></AccessProtectedRoute>} />
              <Route path="/access/users" element={<AccessProtectedRoute allowedRoles={["ADMIN", "AGENCY"]} requiredPermission="users.create"><AccessUsersPage /></AccessProtectedRoute>} />
              <Route path="/access/finance" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessFinancePage /></AccessProtectedRoute>} />
              <Route path="/access/notice" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessNoticePage /></AccessProtectedRoute>} />
              <Route path="/access/agencies" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessAgenciesPage /></AccessProtectedRoute>} />
              <Route path="/access/session-centers" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessSessionCentersPage /></AccessProtectedRoute>} />
              <Route path="/access/test-centers" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessTestCentersPage /></AccessProtectedRoute>} />
              <Route path="/access/section-rules" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><AccessSectionRulesPage /></AccessProtectedRoute>} />
              <Route path="/access/result-verification" element={<AccessProtectedRoute allowedRoles={["ADMIN"]}><ResultVerificationPage /></AccessProtectedRoute>} />

              {/* Takamol Live Console */}
              <Route path="/takamol" element={<TakamolLayout />}>
                <Route index element={<TakamolBookingPage />} />
                <Route path="login" element={<TakamolLoginPage />} />
                <Route path="agent/login" element={<TakamolLoginPage />} />
                <Route path="dashboard" element={<TakamolDashboardPage />} />
                <Route path="booking" element={<TakamolBookingPage />} />
                <Route path="reservations" element={<TakamolReservationsPage />} />
                <Route path="sessions" element={<TakamolSessionsPage />} />
                <Route path="results" element={<TakamolResultsPage />} />
                <Route path="search" element={<TakamolDashboardPage />} />
              </Route>

              {/* Takamol Live Check — no auth required */}
              <Route path="/takamol/live" element={<T2HubLivePage />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </TakamolAuthProvider>
    </AccessAuthProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
