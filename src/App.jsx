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

    // NEW STRUCTURE: Color-first, Lot-second
    // For each color, cut maximally from each lot before moving to the next lot

    const colors = Object.keys(currentDemands)

    colors.forEach(color => {
      const colorDemand = currentDemands[color]

      // Iterate through lots for this color
      fabricLots.forEach(lotGroup => {
        if (lotGroup.totalMetraj <= 0) return // Skip exhausted lots

        let lotMetraj = lotGroup.totalMetraj
        let loopSafety = 0

        while (loopSafety++ < 200) {
          // Check if this color still has demand
          const colorSizes = Object.keys(colorDemand).filter(s => colorDemand[s] > 0)
          if (colorSizes.length === 0) break
          if (lotMetraj <= 0) break

          const totalColorDemand = colorSizes.reduce((sum, s) => sum + colorDemand[s], 0)

          // Generate candidates for THIS COLOR only
          const candidates = []
          const sizeGroups = generateSizeGroups(colorSizes)

          const maxDemand = Math.max(...colorSizes.map(s => colorDemand[s]))
          const BIG_DEMAND_THRESHOLD = maxDemand * 0.35

          sizeGroups.forEach(group => {
            const ratio = {}
            group.forEach(s => ratio[s] = (ratio[s] || 0) + 1)

            let markerLen = 0
            Object.entries(ratio).forEach(([s, r]) => {
              const cons = (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption
              markerLen += (cons * r)
            })
            if (markerLen === 0) return

            // Max layers from demand
            let maxLayersDemand = Infinity
            Object.entries(ratio).forEach(([s, r]) => {
              maxLayersDemand = Math.min(maxLayersDemand, Math.floor((colorDemand[s] || 0) / r))
            })
            if (maxLayersDemand === 0) return

            // Max layers from fabric
            const maxLayersFabric = Math.floor(lotMetraj / markerLen)

            const targetLayers = Math.min(HARD_CAP, maxLayersDemand, maxLayersFabric)
            if (targetLayers <= 0) return

            const piecesPerLayer = group.length
            const totalPieces = piecesPerLayer * targetLayers

            // AGGRESSIVE MINIMUM LAYER FILTER
            // Main Phase: If we have substantial demand (>100 pcs), reject cuts under 15 layers
            // This prevents 2-3 layer garbage cuts
            if (totalColorDemand > 100 && targetLayers < 15) return

            // Also reject if a SIZE is limiting us to low layers while others could go deeper
            // Find which size is the bottleneck
            let limitingSize = null
            let limitingLayers = Infinity
            Object.entries(ratio).forEach(([s, r]) => {
              const maxForThis = Math.floor((colorDemand[s] || 0) / r)
              if (maxForThis < limitingLayers) {
                limitingLayers = maxForThis
                limitingSize = s
              }
            })

            // If a small-demand size is limiting us to <20 layers, skip this combination
            // Let deeper cuts happen without this size, then clean it up later
            if (limitingLayers < 20 && Object.keys(ratio).length > 1) {
              const limitingSizeDemand = colorDemand[limitingSize] || 0
              const avgDemand = totalColorDemand / colorSizes.length
              // If limiting size has much less demand than average, reject
              if (limitingSizeDemand < avgDemand * 0.5) return
            }

            candidates.push({
              group, ratio, markerLen, targetLayers, totalPieces
            })
          })

          if (candidates.length === 0) break

          // SELECTION: Prioritize deep cuts
          const priorityCandidates = candidates.filter(c => c.targetLayers >= HARD_CAP)
          const deepSingleCandidates = candidates.filter(c =>
            Object.keys(c.ratio).length === 1 && c.targetLayers >= DEEP_CUT_THRESHOLD
          )

          let finalCandidates = candidates
          let selectionReason = 'Standard'

          if (priorityCandidates.length > 0) {
            finalCandidates = priorityCandidates
            selectionReason = 'Priority (80L)'
          } else if (deepSingleCandidates.length > 0) {
            finalCandidates = deepSingleCandidates
            selectionReason = 'Deep Single Lock'
          }

          // SCORING - WITH COMBINATION PRIORITY
          let best = null
          let maxScore = -Infinity

          finalCandidates.forEach(cand => {
            const currentCutsEst = Math.ceil(totalColorDemand / IDEAL_PIECES_PER_CUT)

            let remainingAfter = 0
            Object.entries(colorDemand).forEach(([s, qty]) => {
              const used = (cand.ratio[s] || 0) * cand.targetLayers
              remainingAfter += Math.max(0, qty - used)
            })
            const futureCutsEst = Math.ceil(remainingAfter / IDEAL_PIECES_PER_CUT)
            const cutsSaved = currentCutsEst - futureCutsEst

            const layerRatio = cand.targetLayers / HARD_CAP
            const depthScore = Math.pow(layerRatio, 2) * 15000 // MASSIVE reward for deep cuts

            // Penalty for shallow cuts - this overrides combination benefit
            let shallowPenalty = 0
            if (cand.targetLayers < 20) shallowPenalty = 20000 // Almost never accept
            else if (cand.targetLayers < 30) shallowPenalty = 10000
            else if (cand.targetLayers < 40) shallowPenalty = 5000

            let fragmentPenalty = 0
            Object.entries(cand.ratio).forEach(([s, r]) => {
              const remaining = (colorDemand[s] || 0) - (cand.targetLayers * r)
              if (remaining > 0 && remaining < 20) fragmentPenalty += 2000
            })

            // REDUCED: Combination bonus - still prefer more sizes but not at cost of depth
            const uniqueSizeCount = Object.keys(cand.ratio).length
            const combinationBonus = uniqueSizeCount * 2000 // Reduced from 8000

            // Completion bonus
            let completionBonus = 0
            Object.entries(cand.ratio).forEach(([s, r]) => {
              const remaining = (colorDemand[s] || 0) - (cand.targetLayers * r)
              if (remaining === 0) completionBonus += 1500
            })

            // DEPTH IS KING
            const score = (cutsSaved * 8000)
              + depthScore                    // HUGE weight on depth
              + combinationBonus              // Reduced weight
              + completionBonus
              + (cand.totalPieces * 0.3)
              - shallowPenalty                // MASSIVE penalty for shallow
              - fragmentPenalty

            if (score > maxScore) {
              maxScore = score
              best = { ...cand, score, selectionReason }
            }
          })

          if (!best) break

          // EXECUTE: Cut for this color from this lot
          const layers = best.targetLayers
          const producedQuantities = {}

          Object.entries(best.ratio).forEach(([sz, r]) => {
            const qty = layers * r
            producedQuantities[sz] = qty
            colorDemand[sz] = Math.max(0, (colorDemand[sz] || 0) - qty)
          })

          const usedMetraj = layers * best.markerLen
          lotMetraj -= usedMetraj
          lotGroup.totalMetraj -= usedMetraj // Update the actual lot

          plans.push({
            id: cutNo++,
            shrinkage: `${lotGroup.mold} | LOT: ${lotGroup.lot}`,
            lot: lotGroup.lot,
            mold: lotGroup.mold,
            totalLayers: layers,
            markerRatio: best.ratio,
            markerLength: best.markerLen.toFixed(2),
            rows: [{
              colors: color,
              layers: layers,
              quantities: producedQuantities
            }],
            fabrics: lotGroup.fabrics.map(f => f.topNo).join(', '),
            note: `Color: ${color} | ${best.selectionReason}`
          })
        }
      })
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
        demanded: originalDemanded,
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
