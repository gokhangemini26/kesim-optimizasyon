import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import Login from './components/auth/Login'
import Register from './components/auth/Register'
import CustomerManagement from './components/customers/CustomerManagement'
import DataEntryContainer from './components/data-entry/DataEntryContainer'
import ResultsView from './components/optimization/ResultsView'
import AdminDashboard from './components/admin/AdminDashboard'

function App() {
  const [user, setUser] = useState(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [results, setResults] = useState(null)
  const [optimizationSummary, setOptimizationSummary] = useState(null)
  const navigate = useNavigate()

  // Lifted Data Entry States
  const [orderRows, setOrderRows] = useState([])
  const [fabricRows, setFabricRows] = useState([])
  const [consumptionMode, setConsumptionMode] = useState('AVG')
  const [avgConsumption, setAvgConsumption] = useState(1.25)
  const [sizeConsumptions, setSizeConsumptions] = useState({})
  const [sizeType, setSizeType] = useState('TIP1')
  const [groupingResults, setGroupingResults] = useState(null)

  useEffect(() => {
    // Check for existing session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        setUser({
          ...session.user,
          name: profile?.full_name || session.user.email,
          is_admin: profile?.is_admin || false
        })
      }
    }
    checkSession()
  }, [])

  const handleLogin = (userData) => {
    setUser(userData)
  }

  const handleRegister = (userData) => {
    setUser(userData)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSelectedCustomer(null)
    setIsRegistering(false)
    setResults(null)
    setOptimizationSummary(null)
    setOrderRows([])
    setFabricRows([])
    setGroupingResults(null)
    navigate('/')
  }

  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer)
    navigate('/data-entry')
  }

  // --- Optimization Engine Functions ---

  const generateSizeGroups = (availableSizes) => {
    const groups = []
    const sorted = [...availableSizes].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    )
    const n = sorted.length

    // EXHAUSTIVE ASYMMETRIC SEARCH
    sorted.forEach(s => {
      for (let i = 1; i <= 4; i++) groups.push(Array(i).fill(s))
    })

    if (n >= 2) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const s1 = sorted[i], s2 = sorted[j]
          groups.push([s1, s2])
          groups.push([s1, s1, s2])
          groups.push([s1, s1, s1, s2])
          groups.push([s1, s1, s2, s2])
          groups.push([s1, s2, s2])
          groups.push([s1, s2, s2, s2])
        }
      }
    }

    if (n >= 3) {
      const step = n > 15 ? Math.floor(n / 5) : 1
      for (let i = 0; i < n; i += step) {
        for (let j = i + 1; j < n; j += step) {
          for (let k = j + 1; k < n; k += step) {
            const s1 = sorted[i], s2 = sorted[j], s3 = sorted[k]
            groups.push([s1, s2, s3])
            groups.push([s1, s1, s2, s3])
            groups.push([s1, s2, s2, s3])
            groups.push([s1, s2, s3, s3])
          }
        }
      }
    }

    if (n >= 4) {
      const step = n > 15 ? Math.floor(n / 4) : 1
      for (let i = 0; i < n; i += step) {
        for (let j = i + 1; j < n; j += step) {
          for (let k = j + 1; k < n; k += step) {
            for (let l = k + 1; l < n; l += step) {
              groups.push([sorted[i], sorted[j], sorted[k], sorted[l]])
            }
          }
        }
      }
    }

    return groups
  }

  const handlePreparePlan = async (data) => {
    const { orderRows, groupingResults, avgConsumption } = data
    if (!groupingResults) { alert("Lütfen kumaşları gruplandırın!"); return; }

    const initialDemands = JSON.parse(JSON.stringify(orderRows))
    const currentDemands = {}
    orderRows.forEach(row => {
      currentDemands[row.color] = {}
      Object.entries(row.quantities).forEach(([size, qty]) => {
        currentDemands[row.color][size] = parseInt(qty) || 0
      })
    })

    const fabricLots = [
      ...groupingResults.kalip1.map(g => ({ ...g, mold: 'KALIP - 1' })),
      ...groupingResults.kalip2.map(g => ({ ...g, mold: 'KALIP - 2' }))
    ]

    const plans = []
    let cutNo = 1

    fabricLots.forEach(lotGroup => {
      let lotMetraj = lotGroup.totalMetraj

      while (true) {
        const globalDemand = {}
        Object.values(currentDemands).forEach(colorDemand => {
          Object.entries(colorDemand).forEach(([sz, qty]) => {
            globalDemand[sz] = (globalDemand[sz] || 0) + qty
          })
        })

        const availableSizes = Object.keys(globalDemand).filter(s => globalDemand[s] > 0)
        if (availableSizes.length === 0) break

        const sizeGroups = generateSizeGroups(availableSizes)
        let best = null
        let maxScore = -1

        sizeGroups.forEach(group => {
          const markerLen = group.length * avgConsumption
          if (markerLen === 0) return

          const ratio = {}
          group.forEach(s => ratio[s] = (ratio[s] || 0) + 1)

          const candidateLayers = [80]
          Object.keys(ratio).forEach(s => {
            candidateLayers.push(Math.floor(globalDemand[s] / ratio[s]))
          })
          candidateLayers.push(Math.floor(lotMetraj / markerLen))

          const uniqueLayers = [...new Set(candidateLayers)].filter(l => l > 0 && l <= 80 && l * markerLen <= lotMetraj)
          if (uniqueLayers.length === 0) return

          uniqueLayers.forEach(layers => {
            let usefulPieces = 0
            const tempDemand = { ...globalDemand }

            group.forEach(sz => {
              const canTake = Math.min(layers, tempDemand[sz] || 0)
              usefulPieces += canTake
              tempDemand[sz] -= canTake
            })

            const uniqueness = new Set(group).size
            const score = usefulPieces * 1000 + group.length * 10 + uniqueness

            if (score > maxScore) {
              maxScore = score
              best = { group, layers, markerLen, ratio }
            }
          })
        })

        if (!best) break

        const markerSlots = {}
        Object.entries(best.ratio).forEach(([sz, count]) => {
          markerSlots[sz] = count * best.layers
        })

        const planRows = []
        Object.entries(currentDemands).forEach(([color, demand]) => {
          const rowQuantities = {}
          let colorHasAnything = false

          Object.keys(markerSlots).forEach(sz => {
            const take = Math.min(markerSlots[sz], demand[sz] || 0)
            if (take > 0) {
              rowQuantities[sz] = take
              markerSlots[sz] -= take
              currentDemands[color][sz] -= take
              colorHasAnything = true
            }
          })

          if (colorHasAnything) {
            let maxSectionLayers = 0
            Object.entries(rowQuantities).forEach(([sz, qty]) => {
              maxSectionLayers = Math.max(maxSectionLayers, Math.ceil(qty / best.ratio[sz]))
            })

            planRows.push({
              colors: color,
              layers: maxSectionLayers,
              quantities: rowQuantities
            })
          }
        })

        plans.push({
          id: cutNo++,
          shrinkage: `${lotGroup.mold} | LOT: ${lotGroup.lot}`,
          lot: lotGroup.lot,
          mold: lotGroup.mold,
          totalLayers: best.layers,
          markerRatio: best.ratio,
          rows: planRows,
          fabrics: lotGroup.fabrics.map(f => f.topNo).join(', ')
        })

        lotMetraj -= (best.layers * best.markerLen)
      }
    })

    const allSizesSet = new Set()
    initialDemands.forEach(order => Object.keys(order.quantities).forEach(sz => allSizesSet.add(sz)))
    const allSizes = Array.from(allSizesSet).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))

    const summary = initialDemands.map(order => {
      const planned = {}
      allSizes.forEach(sz => {
        planned[sz] = 0
        plans.forEach(plan => plan.rows.forEach(r => {
          if (r.colors === order.color) planned[sz] += (r.quantities[sz] || 0)
        }))
      })
      return { color: order.color, demanded: order.quantities, planned }
    })

    // --- Log the run to Supabase ---
    if (user) {
      const totalPlannedCount = summary.reduce((acc, row) => acc + Object.values(row.planned).reduce((a, b) => a + b, 0), 0)
      await supabase.from('logs').insert([{
        user_id: user.id,
        action: 'OPTIMIZATION_RUN',
        details: {
          plans_count: plans.length,
          total_pieces: totalPlannedCount,
          customer: selectedCustomer?.name
        }
      }])
    }

    setResults(plans); setOptimizationSummary(summary); navigate('/results')
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
            <DataEntryContainer customer={selectedCustomer} onPreparePlan={handlePreparePlan} orderRows={orderRows} setOrderRows={setOrderRows} fabricRows={fabricRows} setFabricRows={setFabricRows} consumptionMode={consumptionMode} setConsumptionMode={setConsumptionMode} avgConsumption={avgConsumption} setAvgConsumption={setAvgConsumption} sizeConsumptions={sizeConsumptions} setSizeConsumptions={setSizeConsumptions} sizeType={sizeType} setSizeType={setSizeType} groupingResults={groupingResults} setGroupingResults={setGroupingResults} />
          </div>
        ) : <Navigate to="/" />} />
        <Route path="/results" element={results ? <ResultsView plans={results} summary={optimizationSummary} onBack={() => { setResults(null); setOptimizationSummary(null); navigate('/data-entry') }} /> : <Navigate to="/" />} />
      </Routes>
    </div>
  )
}

export default App
