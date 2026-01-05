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

    // 1. Setup Demands & Tolerances
    const initialDemands = JSON.parse(JSON.stringify(orderRows))
    const currentDemands = {} // Structure: { [color]: { [size]: qty } }
    const toleranceMap = {}   // Structure: { [color]: { global: maxTotal, [size]: maxQty } }

    orderRows.forEach(row => {
      currentDemands[row.color] = {}
      toleranceMap[row.color] = {}

      Object.entries(row.quantities).forEach(([size, qty]) => {
        const val = parseInt(qty) || 0
        currentDemands[row.color][size] = val
        // 5% Tolerance, Minimum 1 piece if qty > 0 to allow at least some flex
        toleranceMap[row.color][size] = Math.ceil(val * 0.05)
      })
    })

    // 2. Setup Lots
    const fabricLots = [
      ...groupingResults.kalip1.map(g => ({ ...g, mold: 'KALIP - 1', remainingMetraj: g.totalMetraj })),
      ...groupingResults.kalip2.map(g => ({ ...g, mold: 'KALIP - 2', remainingMetraj: g.totalMetraj })),
      ...(groupingResults.kalip3 || []).map(g => ({ ...g, mold: 'KALIP - 3', remainingMetraj: g.totalMetraj }))
    ]

    const plans = []
    let cutNo = 1

    // --- Helper: Optimization Core Step ---
    const findBestCut = (activeDemands, lotMetraj) => {
      // Calculate Global Demand & Global Tolerance for Active Set
      const globalDemand = {}
      const globalTolerance = {}

      Object.keys(activeDemands).forEach(color => {
        const colorDemand = activeDemands[color]
        const colorTol = toleranceMap[color] || {}

        Object.entries(colorDemand).forEach(([sz, qty]) => {
          // qty is remaining demand (positive) or overproduction (negative)
          // We can cut if qty > -tolerance
          globalDemand[sz] = (globalDemand[sz] || 0) + qty
          globalTolerance[sz] = (globalTolerance[sz] || 0) + (colorTol[sz] || 0)
        })
      })

      // Available sizes are those where we haven't hit the negative tolerance limit yet
      const availableSizes = Object.keys(globalDemand).filter(s => globalDemand[s] > -globalTolerance[s])
      if (availableSizes.length === 0) return null

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
          const capacity = (globalDemand[s] || 0) + (globalTolerance[s] || 0)
          candidateLayers.push(capacity > 0 ? Math.floor(capacity / ratio[s]) : 0)
        })
        candidateLayers.push(Math.floor(maxMetraj / markerLen))

        const uniqueLayers = [...new Set(candidateLayers)].filter(l => l > 0 && l <= 80 && l * markerLen <= maxMetraj)
        if (uniqueLayers.length === 0) return

        uniqueLayers.forEach(layers => {
          let usefulPieces = 0
          let overproducedPieces = 0
          let tempDemand = { ...globalDemand }

          group.forEach(sz => {
            const produced = layers
            const needed = Math.max(0, tempDemand[sz])
            const takeReal = Math.min(needed, produced)
            usefulPieces += takeReal
            overproducedPieces += (produced - takeReal)
            tempDemand[sz] -= produced
          })

          const uniqueness = new Set(group).size
          const score = (usefulPieces * 1000) + (overproducedPieces * 50) + (group.length * 10) + uniqueness

          if (score > maxScore) {
            maxScore = score
            best = { group, layers, markerLen, ratio }
          }
        })
      })

      return best
    }

    // --- Process Each Mold Group ---
    Object.entries(moldGroups).forEach(([moldName, lots]) => {
      // Sort lots by size descending (helps to use big lots first)
      lots.sort((a, b) => b.totalMetraj - a.totalMetraj)

      while (true) {
        // Calculate Total Available Metraj in this Group
        let totalAvailable = lots.reduce((acc, l) => acc + l.remainingMetraj, 0)
        if (totalAvailable <= 0) break;

        // Check Global Demand
        const hasAnyCapacity = Object.keys(currentDemands).some(color =>
          Object.entries(currentDemands[color]).some(([sz, q]) => q > -(toleranceMap[color][sz] || 0))
        )
        if (!hasAnyCapacity) break;

        // Find Best Cut Plan for the ENTIRE Group resource
        // We pretend we have one giant roll of 'totalAvailable' length
        const best = findBestCut(currentDemands, totalAvailable)
        if (!best) break;

        // Now check if we can actually execute this 'best' plan using sequential lots
        // We need 'best.layers' amount. 
        // Logic: We consume lots one by one until we get 'best.layers' * 'best.markerLen' total meters.

        let layersToProduce = best.layers
        const planLots = [] // Tracks which lots are used: { lot: '...', layers: 10 }
        const colorAllocations = {} // Tracks what color we cut: { 'Red': { layers: 10, ... } }

        // Initialize colorAllocations for logic
        const colors = Object.keys(currentDemands)
        colors.forEach(c => colorAllocations[c] = { layers: 0, fromLots: [] })

        // We iterate lots and consume layers
        for (let i = 0; i < lots.length; i++) {
          const lot = lots[i]
          if (lot.remainingMetraj < best.markerLen) continue; // Skip scrap lots < 1 marker length

          // How many layers can this lot provide?
          const maxLayersFromLot = Math.floor(lot.remainingMetraj / best.markerLen)
          const takeLayers = Math.min(layersToProduce, maxLayersFromLot)

          if (takeLayers > 0) {
            // We take 'takeLayers' from this Lot
            // Now, who gets these layers? (Which Color)
            // Greedy Color Allocation FOR THIS SPECIFIC LOT's LAYERS

            let lotLayersLeft = takeLayers
            while (lotLayersLeft > 0) {
              let bestColor = null
              let maxNeedScore = -Infinity

              Object.entries(currentDemands).forEach(([color, demandMap]) => {
                let realNeed = 0
                let toleranceSpace = 0
                let totalRemainingDemand = 0

                best.group.forEach(sz => {
                  const current = demandMap[sz] || 0
                  const tol = toleranceMap[color][sz] || 0
                  if (current > 0) { realNeed += 1; totalRemainingDemand += current }
                  else if (current > -tol) { toleranceSpace += 1 }
                })

                let score = -Infinity
                if (realNeed > 0 || toleranceSpace > 0) {
                  // Priority: Real Need > Balance > Tolerance
                  // Add slight randomness or rotation to prevent sticking to same color if equal?
                  // No, sticking is good (Single Lot per Color preference).
                  score = (realNeed * 100000) + (totalRemainingDemand * 10) + (toleranceSpace * 1)
                }
                if (score > maxNeedScore) { maxNeedScore = score; bestColor = color }
              })

              if (bestColor) {
                colorAllocations[bestColor].layers += 1
                // Track which lot this color usage came from (for display/audit if needed)
                // Note: We just update Demand here.
                Object.entries(best.ratio).forEach(([sz, qtyPerLayer]) => {
                  currentDemands[bestColor][sz] = (currentDemands[bestColor][sz] || 0) - qtyPerLayer
                })
                lotLayersLeft--
              } else {
                // Force assignment to first available if no one ideally wants it (filling tolerance or avoiding crash)
                // Should be rare due to findBestCut logic
                const anyColor = colors.find(c => Object.values(currentDemands[c]).some(q => q > -999))
                if (anyColor) {
                  colorAllocations[anyColor].layers += 1
                  Object.entries(best.ratio).forEach(([sz, qtyPerLayer]) => {
                    currentDemands[anyColor][sz] = (currentDemands[anyColor][sz] || 0) - qtyPerLayer
                  })
                  lotLayersLeft--
                } else {
                  break; // Should break outer loop really
                }
              }
            }

            planLots.push({ lot: lot.lot, layers: takeLayers, usedMetraj: takeLayers * best.markerLen })
            lot.remainingMetraj -= (takeLayers * best.markerLen)
            layersToProduce -= takeLayers
          }

          if (layersToProduce === 0) break;
        }

        // If we couldn't fulfill ANY layers (e.g. lots too small for marker), avoid infinite loop
        if (best.layers === layersToProduce) {
          // Optimization found a plan but no lot could support even 1 layer?
          // Break to avoid loop.
          break;
        }

        // If we partially fulfilled (e.g. lots ran out), we still record the plan for what we did
        const executedLayers = best.layers - layersToProduce
        if (executedLayers === 0) break;

        // Construct Plan Row Data
        const planRows = []
        Object.entries(colorAllocations).forEach(([color, data]) => {
          if (data.layers > 0) {
            const rowQuantities = {}
            Object.entries(best.ratio).forEach(([sz, ratio]) => {
              rowQuantities[sz] = data.layers * ratio
            })
            planRows.push({
              colors: color,
              layers: data.layers,
              quantities: rowQuantities
            })
          }
        })

        plans.push({
          id: cutNo++,
          shrinkage: `${moldName}`,
          lot: planLots.map(pl => pl.lot).join(', '), // Multi Lot Display
          mold: moldName,
          totalLayers: executedLayers,
          markerRatio: best.ratio,
          rows: planRows,
          fabrics: planLots.map(pl => `${pl.lot} (${pl.layers})`).join(', ') // Detailed usage
        })
      }
    })

    // 4. Summarize & Finalize
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
