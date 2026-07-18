import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import Login from './components/auth/Login'
import Register from './components/auth/Register'
import CustomerManagement from './components/customers/CustomerManagement'
import DataEntryContainer from './components/data-entry/DataEntryContainer'
import ResultsView from './components/optimization/ResultsView'
import AdminDashboard from './components/admin/AdminDashboard'
import { generateSummary } from './utils/OptimizationEngine'
import { solveAsorti } from './utils/asortiClient'

function App() {
  const [user, setUser] = useState({
    id: 'local-user',
    name: 'Yerel Kullanıcı',
    is_admin: false
  })
  const [isRegistering, setIsRegistering] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(() => {
    const saved = localStorage.getItem('selectedCustomer')
    return saved ? JSON.parse(saved) : null
  })
  const [results, setResults] = useState(() => {
    const saved = localStorage.getItem('results')
    return saved ? JSON.parse(saved) : null
  })
  const [optimizationSummary, setOptimizationSummary] = useState(() => {
    const saved = localStorage.getItem('optimizationSummary')
    return saved ? JSON.parse(saved) : null
  })
  const [isOptimizing, setIsOptimizing] = useState(false)
  const navigate = useNavigate()

  // Lifted Data Entry States
  const [orderRows, setOrderRows] = useState(() => {
    const saved = localStorage.getItem('orderRows')
    return saved ? JSON.parse(saved) : []
  })
  const [fabricRows, setFabricRows] = useState(() => {
    const saved = localStorage.getItem('fabricRows')
    return saved ? JSON.parse(saved) : []
  })
  const [consumptionMode, setConsumptionMode] = useState(() => {
    const saved = localStorage.getItem('consumptionMode')
    return saved || 'AVG'
  })
  const [avgConsumption, setAvgConsumption] = useState(() => {
    const saved = localStorage.getItem('avgConsumption')
    return saved ? parseFloat(saved) : 1.4
  })
  const [sizeConsumptions, setSizeConsumptions] = useState(() => {
    const saved = localStorage.getItem('sizeConsumptions')
    return saved ? JSON.parse(saved) : {}
  })
  const [sizeType, setSizeType] = useState(() => {
    const saved = localStorage.getItem('sizeType')
    return saved || 'TIP1'
  })
  const [groupingResults, setGroupingResults] = useState(() => {
    const saved = localStorage.getItem('groupingResults')
    return saved ? JSON.parse(saved) : null
  })

  // Synchronize states to localStorage
  useEffect(() => {
    if (selectedCustomer) {
      localStorage.setItem('selectedCustomer', JSON.stringify(selectedCustomer))
    } else {
      localStorage.removeItem('selectedCustomer')
    }
  }, [selectedCustomer])

  useEffect(() => {
    if (results) {
      localStorage.setItem('results', JSON.stringify(results))
    } else {
      localStorage.removeItem('results')
    }
  }, [results])

  useEffect(() => {
    if (optimizationSummary) {
      localStorage.setItem('optimizationSummary', JSON.stringify(optimizationSummary))
    } else {
      localStorage.removeItem('optimizationSummary')
    }
  }, [optimizationSummary])

  useEffect(() => {
    localStorage.setItem('orderRows', JSON.stringify(orderRows))
  }, [orderRows])

  useEffect(() => {
    localStorage.setItem('fabricRows', JSON.stringify(fabricRows))
  }, [fabricRows])

  useEffect(() => {
    localStorage.setItem('consumptionMode', consumptionMode)
  }, [consumptionMode])

  useEffect(() => {
    localStorage.setItem('avgConsumption', avgConsumption.toString())
  }, [avgConsumption])

  useEffect(() => {
    localStorage.setItem('sizeConsumptions', JSON.stringify(sizeConsumptions))
  }, [sizeConsumptions])

  useEffect(() => {
    localStorage.setItem('sizeType', sizeType)
  }, [sizeType])

  useEffect(() => {
    if (groupingResults) {
      localStorage.setItem('groupingResults', JSON.stringify(groupingResults))
    } else {
      localStorage.removeItem('groupingResults')
    }
  }, [groupingResults])

  const handleLogin = (userData) => {
    setUser(userData)
  }

  const handleRegister = (userData) => {
    setUser(userData)
  }

  const handleLogout = () => {
    setSelectedCustomer(null)
    setIsRegistering(false)
    setResults(null)
    setOptimizationSummary(null)
    setOrderRows([])
    setFabricRows([])
    setGroupingResults(null)
    localStorage.removeItem('selectedCustomer')
    localStorage.removeItem('results')
    localStorage.removeItem('optimizationSummary')
    localStorage.setItem('orderRows', JSON.stringify([]))
    localStorage.setItem('fabricRows', JSON.stringify([]))
    localStorage.removeItem('groupingResults')
    navigate('/customers')
  }

  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer)
    navigate('/data-entry')
  }

  // --- Optimization Engine Functions ---


  const handlePreparePlan = async (data) => {
    const { orderRows, fabricRows, groupingResults } = data
    if (!groupingResults) { alert("Lütfen kumaşları gruplandırın!"); return; }
    if (!fabricRows || fabricRows.length === 0) { alert("Kumaş verisi yok!"); return; }

    try {
      setIsOptimizing(true)

      const { plans, integrityMap, asortiMatrix, allocation, stats } = await solveAsorti(data)

      console.log('✅ Asorti Engine Sonuçları:', plans, stats)

      const summary = generateSummary(orderRows, plans, integrityMap)

      // Logging skipped locally to bypass database integration

      const metrajInfo = {
        initial: stats.availableMetraj.toFixed(2),
        used: stats.usedMetraj.toFixed(2),
        remaining: (stats.availableMetraj - stats.usedMetraj).toFixed(2),
        usagePercent: stats.utilization
      }

      setResults(plans)
      setOptimizationSummary({ summary, metrajInfo, asortiMatrix, allocation, stats })
      navigate('/results')

    } catch (error) {
      console.error("Optimization Error:", error)
      alert("Optimizasyon sırasında bir hata oluştu: " + error.message)
    } finally {
      setIsOptimizing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Routes>
        <Route path="/" element={user ? (selectedCustomer ? (results ? <Navigate to="/results" /> : <Navigate to="/data-entry" />) : <Navigate to="/customers" />) : (isRegistering ? <Register onRegister={handleRegister} onSwitchToLogin={() => setIsRegistering(false)} /> : <Login onLogin={handleLogin} onSwitchToRegister={() => setIsRegistering(true)} />)} />
        <Route path="/customers" element={user ? <CustomerManagement onSelectCustomer={handleSelectCustomer} onLogout={handleLogout} /> : <Navigate to="/" />} />
        <Route path="/admin" element={user?.is_admin ? <AdminDashboard /> : <Navigate to="/" />} />
        <Route path="/data-entry" element={user && selectedCustomer ? (
          <div className="max-w-7xl mx-auto p-4 md:p-8 text-slate-900">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Müşteri Detayları</h2>
                <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">{selectedCustomer.name} <span className="text-xs font-medium bg-primary-100 text-primary-700 px-2 py-1 rounded-lg">AKTİF SEÇİM</span></h1>
                <div className="flex gap-4 mt-2 text-sm text-slate-500 font-medium">
                  <span className="flex items-center gap-1">En Tolerans: <span className="text-slate-900 font-bold">±{selectedCustomer.enTolerance}%</span></span>
                  <span className="flex items-center gap-1">Boy Tolerans: <span className="text-slate-900 font-bold">±{selectedCustomer.boyTolerance}%</span></span>
                </div>
              </div>
              <div className="flex gap-3">
                {user?.is_admin && <button onClick={() => navigate('/admin')} className="bg-primary-50 hover:bg-primary-100 text-primary-700 font-bold px-5 py-2.5 rounded-xl transition-all border border-primary-100">Yönetim Paneli</button>}
                <button onClick={() => { setSelectedCustomer(null); navigate('/customers') }} className="bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold px-5 py-2.5 rounded-xl transition-all border border-slate-200">Müşteri Değiştir</button>
                <button onClick={handleLogout} className="bg-red-50 hover:bg-red-100 text-red-600 font-bold px-5 py-2.5 rounded-xl transition-all border border-red-100">Çıkış Yap</button>
              </div>
            </header>
            <DataEntryContainer isOptimizing={isOptimizing} customer={selectedCustomer} onPreparePlan={handlePreparePlan} orderRows={orderRows} setOrderRows={setOrderRows} fabricRows={fabricRows} setFabricRows={setFabricRows} consumptionMode={consumptionMode} setConsumptionMode={setConsumptionMode} avgConsumption={avgConsumption} setAvgConsumption={setAvgConsumption} sizeConsumptions={sizeConsumptions} setSizeConsumptions={setSizeConsumptions} sizeType={sizeType} setSizeType={setSizeType} groupingResults={groupingResults} setGroupingResults={setGroupingResults} />
          </div>
        ) : <Navigate to="/" />} />
        <Route path="/results" element={results ? <ResultsView plans={results} summary={optimizationSummary} onBack={() => { setResults(null); setOptimizationSummary(null); navigate('/data-entry') }} /> : <Navigate to="/" />} />
      </Routes>
    </div>
  )
}

export default App
