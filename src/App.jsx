import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { useAuthStore } from './store/authStore'
import Layout    from './components/Layout/Layout'
import LoginPage from './pages/Login/LoginPage'

const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage'))
const InventoryPage = lazy(() => import('./pages/Inventory/InventoryPage'))
const VentasPage    = lazy(() => import('./pages/Ventas/VentasPage'))
const ReportsPage   = lazy(() => import('./pages/Reports/ReportsPage'))
const SettingsPage  = lazy(() => import('./pages/Settings/SettingsPage'))
const CustomersPage = lazy(() => import('./pages/Customers/CustomersPage'))
const CashRegisterPage = lazy(() => import('./pages/CashRegister/CashRegisterPage'))

function PrivateRoute({ children, permission }) {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (permission && !user.permissions.includes(permission)) return <Navigate to="/" replace />
  return children
}

function PageLoader() {
  return (
    <div className="app-loader" role="status">
      <div className="spinner" />
      <div>Cargando...</div>
    </div>
  )
}

export default function App() {
  const { user } = useAuthStore()
  return (
    <HashRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="inventory" element={<PrivateRoute permission="inventory"><InventoryPage /></PrivateRoute>} />
            <Route path="ventas"    element={<PrivateRoute permission="sales"><VentasPage /></PrivateRoute>} />
            <Route path="reports"   element={<PrivateRoute permission="reports"><ReportsPage /></PrivateRoute>} />
            <Route path="customers" element={<PrivateRoute permission="customers"><CustomersPage /></PrivateRoute>} />
            <Route path="cash"      element={<PrivateRoute permission="cash_register"><CashRegisterPage /></PrivateRoute>} />
            <Route path="settings"  element={<PrivateRoute permission="settings"><SettingsPage /></PrivateRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
