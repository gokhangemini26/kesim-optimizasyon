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
  const [avgConsumption, setAvgConsumption] = useState(1.4)
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
    // 1. Single Sizes
    sorted.forEach(s => {
      groups.push([s])            // 1x
      groups.push([s, s])         // 2x
      groups.push([s, s, s])      // 3x
      groups.push([s, s, s, s])   // 4x
    })

    // 2. Pairs (2 sizes)
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

    // 3. Triples (3 sizes)
    if (n >= 3) {
      // Limit search space for performance if needed, but 3 levels is usually ok
      const step = n > 15 ? Math.floor(n / 5) : 1
      for (let i = 0; i < n; i += step) {
        for (let j = i + 1; j < n; j += step) {
          for (let k = j + 1; k < n; k += step) {
            const s1 = sorted[i], s2 = sorted[j], s3 = sorted[k]
            // Standard 1-1-1
            groups.push([s1, s2, s3])
            // Weighted variations (Heavy on one)
            groups.push([s1, s1, s2, s3])
            groups.push([s1, s2, s2, s3])
            groups.push([s1, s2, s3, s3])
          }
        }
      }
    }

    // 4. Quads (4 sizes)
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
    const { orderRows, groupingResults, avgConsumption, consumptionMode, sizeConsumptions } = data
    if (!groupingResults) { alert("Lütfen kumaşları gruplandırın!"); return; }

    const initialDemands = JSON.parse(JSON.stringify(orderRows))
    const currentDemands = {} // Color -> Size -> Qty
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

    // Optimization Goals Constants
    const HARD_CAP = 80
    const DEEP_CUT_THRESHOLD = 65
    const IDEAL_PIECES_PER_CUT = 160 // 4 sizes * 40 layers approx

    fabricLots.forEach(lotGroup => {
      let lotMetraj = lotGroup.totalMetraj

      while (true) {
        // A. CONSOLIDATE GLOBAL DEMAND
        // Hybrid Approach: We optimize for the aggregate demand to minimize cuts,
        // then distribute back to colors.
        const globalDemand = {}
        Object.values(currentDemands).forEach(colorDemand => {
          Object.entries(colorDemand).forEach(([sz, qty]) => {
            globalDemand[sz] = (globalDemand[sz] || 0) + qty
          })
        })

        const availableSizes = Object.keys(globalDemand).filter(s => globalDemand[s] > 0)
        if (availableSizes.length === 0) break

        const totalRemainingQty = Object.values(globalDemand).reduce((a, b) => a + b, 0)

        // B. CANDIDATE GENERATION
        const candidates = []
        ratio = { [uniqueSizes[0]]: 2, [uniqueSizes[1]]: 2 }
        type = 'PAIR (2+2)'
      } else if (sizeCount === 3) {
        const maxDemandSize = uniqueSizes.sort((a, b) => currentDemands[b] - currentDemands[a])[0]
        ratio = {}
        uniqueSizes.forEach(s => ratio[s] = (s === maxDemandSize ? 2 : 1))
        type = 'TRIPLE (2+1+1)'
      } else {
        ratio = {}
        candidateSizes.forEach(s => ratio[s] = 1)
        type = 'QUAD (1x4)'
      }

      // Calc
      let currentLength = 0
      let piecesPerLayer = 0
      Object.entries(ratio).forEach(([s, r]) => {
        currentLength += getConsumption(s) * r
        piecesPerLayer += r
      })
      if (currentLength === 0) return

      const maxLayersFabric = Math.floor(currentGroup.totalMetraj / currentLength)
      let maxLayersDemand = Infinity
      Object.entries(ratio).forEach(([s, r]) => {
        const d = currentDemands[s] || 0
        maxLayersDemand = Math.min(maxLayersDemand, Math.floor(d / r))
      })
      if (maxLayersDemand === 0) maxLayersDemand = 1

      const HARD_CAP = 80
      let targetLayers = Math.min(HARD_CAP, maxLayersFabric, maxLayersDemand)

      if (targetLayers <= 0) return

      const totalPieces = piecesPerLayer * targetLayers

      // POINT 5: MIN YIELD FILTER (Unless it's the last crumbs)
      // If total remaining is large, don't accept tiny cuts
      const MIN_YIELD = avgConsumption > 0 ? 50 : 20 // Arbitrary piece count floor
      if (totalRemaining > 200 && totalPieces < 40) return

      possibleCandidates.push({
        ratio, type, targetLayers, totalPieces, currentLength, candidateSizes
      })
    })

    if (possibleCandidates.length === 0) break

    // POINT 2: PRIORITY LOCK (80 Layers)
    const priorityCandidates = possibleCandidates.filter(c => c.targetLayers >= 80)

    // POINT 4: SAME-SIZE LOCK
    // Check if any single size can do deep cut (e.g. > 65 layers) strictly on its own
    const deepSingleCandidates = possibleCandidates.filter(c =>
      c.candidateSizes.length === 1 && c.targetLayers >= 65
    )

    let finalCandidates = possibleCandidates

    if (priorityCandidates.length > 0) {
      finalCandidates = priorityCandidates // Ignore everything else if we have 80 layers
    } else if (deepSingleCandidates.length > 0) {
      finalCandidates = deepSingleCandidates // Prefer cleaning single sizes deeply
    }

    // SCORING
    finalCandidates.forEach(cand => {
      // POINT 1: CUTS SAVED METRIC (Global Goal)
      // simulate future cuts
      // Crude simulation: Total Remaining After This / Ideal Pieces Per Cut (e.g. 200)

      // State BEFORE
      const currentTotalRemaining = Object.values(currentDemands).reduce((a, b) => a + b, 0)
      const estimatedCutsBefore = Math.ceil(currentTotalRemaining / 160) // 160 approx ideal pcs per cut (40 layers * 4)

      // State AFTER
      let remAfter = 0
      Object.entries(currentDemands).forEach(([s, qty]) => {
        const consumed = cand.ratio[s] ? cand.targetLayers * cand.ratio[s] : 0
        remAfter += Math.max(0, qty - consumed)
      })
      const estimatedCutsAfter = Math.ceil(remAfter / 160)

      const cutsSaved = estimatedCutsBefore - estimatedCutsAfter

      // SCORE
      // Global Goal: CutsSaved is KING.
      // Secondary: Efficiency (Layers).

      const score = (cutsSaved * 3000)
        + (cand.totalPieces * 1.0)
        + ((cand.targetLayers / 80) * 500) // Layer efficiency

      // POINT 6: REAL LOOK-AHEAD (Future Fragmentation)
      // Penalize leaving random small bits
      let fragmentPenalty = 0
      Object.entries(cand.ratio).forEach(([s, r]) => {
        const remaining = (currentDemands[s] || 0) - (cand.targetLayers * r)
        if (remaining > 0 && remaining < 20) fragmentPenalty += 2000 // Huge penalty for leaving crumbs
      })

      const finalScore = score - fragmentPenalty

      if (finalScore > bestScore) {
        bestScore = finalScore
        bestCandidate = {
          ...cand,
          score: finalScore,
          note: `GS:${cutsSaved} L:${cand.targetLayers}`
        }
      }
    })

    if (!bestCandidate) {
      currentGroup.totalMetraj = 0
      continue
    }

    // EXECUTE
    const { ratio, targetLayers: layers, currentLength: length, type, note } = bestCandidate

    const producedQuantities = {}
    Object.entries(ratio).forEach(([size, r]) => {
      const qty = layers * r
      producedQuantities[size] = qty
      remainingDemands[color][size] = Math.max(0, remainingDemands[color][size] - qty)
    })

    const usedMetraj = layers * length
    currentGroup.totalMetraj -= usedMetraj

    plans.push({
      id: cutNo++,
      shrinkage: `${currentGroup.mold} | LOT: ${currentGroup.lot}`,
      lot: currentGroup.lot,
      mold: currentGroup.mold,
      totalLayers: layers,
      markerRatio: ratio,
      markerLength: length.toFixed(2),
      rows: [{
        colors: color,
        layers: layers,
        quantities: producedQuantities
      }],
      fabrics: currentGroup.fabrics.map(f => f.topNo).join(', '),
      usedMetraj: usedMetraj.toFixed(2),
      availableMetraj: (currentGroup.totalMetraj + usedMetraj).toFixed(2),
      remainingMetraj: currentGroup.totalMetraj.toFixed(2),
      note: note || `Score: ${Math.floor(bestCandidate.score)}`
    })
  }
})

console.log('✅ Scoring Engine Sonuçları:', plans)

// ✅ 12. ÖZET RAPOR OLUŞTUR
const allSizesSet = new Set()
orderRows.forEach(order => {
  Object.keys(order.quantities).forEach(sz => allSizesSet.add(sz))
})
const allSizes = Array.from(allSizesSet).sort((a, b) =>
  String(a).localeCompare(String(b), undefined, { numeric: true })
)

const summary = orderRows.map(order => {
  const originalDemanded = {}
  const planned = {}

  allSizes.forEach(sz => {
    originalDemanded[sz] = parseInt(order.quantities[sz]) || 0
    planned[sz] = 0

    plans.forEach(plan => {
      plan.rows.forEach(r => {
        if (r.colors === order.color) {
          planned[sz] += (r.quantities[sz] || 0)
        }
      })
    })
  })

  return {
    color: order.color,
    demanded: originalDemanded, // Orijinal sipariş
    demandedWithExtra: colorDemands[order.color], // %5 fazla dahil
    planned: planned
  }
})

// ✅ 13. LOGLAMA
if (user) {
  const totalPlannedCount = summary.reduce((acc, row) =>
    acc + Object.values(row.planned).reduce((a, b) => a + b, 0), 0
  )
  await supabase.from('logs').insert([{
    user_id: user.id,
    action: 'OPTIMIZATION_RUN',
    details: {
      plans_count: plans.length,
      total_pieces: totalPlannedCount,
      customer: selectedCustomer?.name,
      extra_percentage: 5
    }
  }])
}

console.log('✅ Oluşturulan Planlar:', plans)
console.log('📊 Özet Rapor:', summary)

setResults(plans)
setOptimizationSummary(summary)
navigate('/results')
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
