import { lazy, Suspense } from "react";
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
import { TakamolAuthProvider } from "@/contexts/TakamolAuthContext";
import TakamolLayout from "@/pages/takamol/TakamolLayout";

const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const OtpPage = lazy(() => import("@/pages/auth/OtpPage"));
const RegisterPage = lazy(() => import("@/pages/auth/RegisterPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const BookingPage = lazy(() => import("@/pages/exam/BookingPage"));
const PaymentPage = lazy(() => import("@/pages/exam/PaymentPage"));
const PaymentResultPage = lazy(() => import("@/pages/exam/PaymentResultPage"));
const ReservationsPage = lazy(() => import("@/pages/exam/ReservationsPage"));
const PaymentHistoryPage = lazy(() => import("@/pages/exam/PaymentHistoryPage"));
const ExamSessionListPage = lazy(() => import("@/pages/exam/ExamSessionListPage"));
const ExamSessionDetailPage = lazy(() => import("@/pages/exam/ExamSessionDetailPage"));
const AccessLoginPage = lazy(() => import("@/pages/access/AccessLoginPage"));
const AccessRegisterPage = lazy(() => import("@/pages/access/AccessRegisterPage"));
const AccessForbiddenPage = lazy(() => import("@/pages/access/AccessForbiddenPage"));
const AccessFinancePage = lazy(() => import("@/pages/access/AccessFinancePage"));
const AccessNoticePage = lazy(() => import("@/pages/access/AccessNoticePage"));
const WalletPage = lazy(() => import("@/pages/WalletPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/access/ForgotPasswordPage"));
const AccessDashboardPage = lazy(() => import("@/pages/access/AccessDashboardPage"));
const AccessAccountsPage = lazy(() => import("@/pages/access/AccessAccountsPage"));
const AccessUsersPage = lazy(() => import("@/pages/access/AccessUsersPage"));
const AccessAgenciesPage = lazy(() => import("@/pages/access/AccessAgenciesPage"));
const AccessSessionCentersPage = lazy(() => import("@/pages/access/AccessSessionCentersPage"));
const AccessTestCentersPage = lazy(() => import("@/pages/access/AccessTestCentersPage"));
const AccessSectionRulesPage = lazy(() => import("@/pages/access/AccessSectionRulesPage"));
const ResultVerificationPage = lazy(() => import("@/pages/access/ResultVerificationPage"));
const TestCenterDetailPage = lazy(() => import("@/pages/exam/TestCenterDetailPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const TakamolLoginPage = lazy(() => import("@/pages/takamol/TakamolLoginPage"));
const TakamolDashboardPage = lazy(() => import("@/pages/takamol/TakamolDashboardPage"));
const TakamolBookingPage = lazy(() => import("@/pages/takamol/TakamolBookingPage"));
const TakamolReservationsPage = lazy(() => import("@/pages/takamol/TakamolReservationsPage"));
const TakamolSessionsPage = lazy(() => import("@/pages/takamol/TakamolSessionsPage"));
const TakamolResultsPage = lazy(() => import("@/pages/takamol/TakamolResultsPage"));
const T2HubLivePage = lazy(() => import("@/pages/takamol/T2HubLivePage"));

const queryClient = new QueryClient();
const LoadingPage = () => <div className="min-h-screen bg-background" aria-busy="true" />;

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
              <Suspense fallback={<LoadingPage />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/access/login" replace />} />
                  <Route path="/auth/login" element={<LoginPage />} />
                  <Route path="/auth/otp" element={<AccessProtectedRoute allowedRoles={["USER"]}><OtpPage /></AccessProtectedRoute>} />
                  <Route path="/auth/register" element={<RegisterPage />} />
                  <Route path="/user" element={<Navigate to="/auth/login" replace />} />
                  <Route path="/dashboard" element={<AccessProtectedRoute allowedRoles={["USER"]}><DashboardPage /></AccessProtectedRoute>} />
                  <Route path="/exam/booking" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="booking.create"><ProtectedRoute><BookingPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/payment" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="payment.create"><ProtectedRoute><PaymentPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/payment/result" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="payment.create"><ProtectedRoute><PaymentResultPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/reservations" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="reservation.manage"><ProtectedRoute><ReservationsPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/payments" element={<AccessProtectedRoute allowedRoles={["USER"]}><ProtectedRoute><PaymentHistoryPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/sessions" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="reservation.manage"><ProtectedRoute><ExamSessionListPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/sessions/:id" element={<AccessProtectedRoute allowedRoles={["USER"]} requiredPermission="reservation.manage"><ProtectedRoute><ExamSessionDetailPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/wallet" element={<AccessProtectedRoute allowedRoles={["USER"]}><ProtectedRoute><WalletPage /></ProtectedRoute></AccessProtectedRoute>} />
                  <Route path="/exam/test-centers/:id" element={<ProtectedRoute><TestCenterDetailPage /></ProtectedRoute>} />
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
                  <Route path="/takamol/live" element={<T2HubLivePage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </TakamolAuthProvider>
      </AccessAuthProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
