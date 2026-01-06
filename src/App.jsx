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

    fabricLots.forEach(lotGroup => {
      let lotMetraj = lotGroup.totalMetraj

      while (true) {
        // A. CONSOLIDATE GLOBAL DEMAND
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
        const sizeGroups = generateSizeGroups(availableSizes)

        // Pre-calculate demands to identify Core vs Fill
        const maxDemand = Math.max(...availableSizes.map(s => globalDemand[s]))
        const BIG_DEMAND_THRESHOLD = maxDemand * 0.35 // Core size threshold

        sizeGroups.forEach(group => {
          // 1. Calculate Ratio & Length
          const ratio = {}
          group.forEach(s => ratio[s] = (ratio[s] || 0) + 1)

          let markerLen = 0
          Object.entries(ratio).forEach(([s, r]) => {
            const cons = (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption
            markerLen += (cons * r)
          })
          if (markerLen === 0) return

          // 2. Calculate Max Layers (Greedy)
          let maxLayersDemand = Infinity
          Object.entries(ratio).forEach(([s, r]) => {
            maxLayersDemand = Math.min(maxLayersDemand, Math.floor((globalDemand[s] || 0) / r))
          })
          if (maxLayersDemand === 0) maxLayersDemand = 1

          const maxLayersFabric = Math.floor(lotMetraj / markerLen)

          const targetLayers = Math.min(HARD_CAP, maxLayersDemand, maxLayersFabric)

          if (targetLayers <= 0) return

          // 3. CONSTRAINTS & FILTERS (The 6-Point Strategy)

          // Constraint 5: MIN YIELD FILTER (Adaptive)
          const piecesPerLayer = group.length
          const totalPieces = piecesPerLayer * targetLayers
          // Adaptive filtering based on remaining work:
          // Only reject very small cuts (< 20 pieces) if we have substantial work left
          if (totalRemainingQty > 500 && totalPieces < 40) return
          if (totalRemainingQty > 200 && totalPieces < 20) return

          // Constraint 3: SMALL SIZE PROTECTION
          let isLimitedByFill = false
          if (targetLayers < 50) {
            const coreInGroup = group.filter(s => globalDemand[s] >= BIG_DEMAND_THRESHOLD)
            const fillInGroup = group.filter(s => globalDemand[s] < BIG_DEMAND_THRESHOLD)
            if (coreInGroup.length > 0 && fillInGroup.length > 0) {
              let maxCoreLayers = Infinity
              coreInGroup.forEach(s => {
                maxCoreLayers = Math.min(maxCoreLayers, Math.floor(globalDemand[s] / (ratio[s] || 1)))
              })
              // If core size can go much deeper alone (+25 layers), reject this mixed cut
              if (maxCoreLayers > targetLayers + 25) isLimitedByFill = true
            }
          }
          if (isLimitedByFill) return // Reject

          candidates.push({
            group, ratio, markerLen, targetLayers, totalPieces
          })
        })

        if (candidates.length === 0) break

        // C. SELECTION LOGIC (Global Optimum)

        // Constraint 2: PRIORITY LOCK (80 Layers)
        const priorityCandidates = candidates.filter(c => c.targetLayers >= HARD_CAP)

        // Constraint 4: SAME-SIZE LOCK (Deep Single Cuts)
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

        // SCORING
        let best = null
        let maxScore = -Infinity

        finalCandidates.forEach(cand => {
          // Constraint 1: CUTS SAVED (Metric)
          const currentCutsEst = Math.ceil(totalRemainingQty / IDEAL_PIECES_PER_CUT)

          let remainingAfter = 0
          Object.entries(globalDemand).forEach(([s, qty]) => {
            const used = (cand.ratio[s] || 0) * cand.targetLayers
            remainingAfter += Math.max(0, qty - used)
          })
          const futureCutsEst = Math.ceil(remainingAfter / IDEAL_PIECES_PER_CUT)

          const cutsSaved = currentCutsEst - futureCutsEst

          // SCORE - REFINED FOR CUT MINIMIZATION
          // Primary: CutsSaved (Huge weight)
          // Secondary: Layer Depth Ratio (We want DEEP cuts, not just many pieces)
          // Penalty: Shallow cuts (< 40 layers) get massive penalty in comparison

          const layerRatio = cand.targetLayers / HARD_CAP // 0.0 to 1.0
          const depthScore = Math.pow(layerRatio, 3) * 5000 // Exponential reward for max depth

          // Massive penalty for cuts < 40 layers if we have other options
          const shallowPenalty = (cand.targetLayers < 40) ? 5000 : 0

          // Constraint 6: LOOK-AHEAD (Fragment Penalty)
          let fragmentPenalty = 0
          Object.entries(cand.ratio).forEach(([s, r]) => {
            const remaining = (globalDemand[s] || 0) - (cand.targetLayers * r)
            if (remaining > 0 && remaining < 20) fragmentPenalty += 2000
          })

          const score = (cutsSaved * 10000)      // Highest Priority
            + depthScore               // Reward 80 layers significantly
            + (cand.totalPieces * 0.5) // Minor tie-breaker
            - shallowPenalty           // Avoid 20-30 layer cuts if possible
            - fragmentPenalty

          if (score > maxScore) {
            maxScore = score
            best = { ...cand, score, selectionReason }
          }
        })

        if (!best) break

        // D. EXECUTE (Greedy Layer Allocation to Colors)

        const colorAllocations = {}
        Object.keys(currentDemands).forEach(color => {
          colorAllocations[color] = { layers: 0 }
        })

        let remainingLayers = best.targetLayers

        // Distribute layers to colors
        while (remainingLayers > 0) {
          let bestColor = null
          let maxNeedScore = -1

          Object.entries(currentDemands).forEach(([color, demandMap]) => {
            let absorption = 0
            let pendingTotal = 0
            Object.entries(best.ratio).forEach(([sz, r]) => {
              const need = demandMap[sz] || 0
              if (need > 0) absorption += Math.min(need, r)
              pendingTotal += need
            })

            if (absorption > 0) {
              const score = (absorption * 1000) + pendingTotal
              if (score > maxNeedScore) {
                maxNeedScore = score
                bestColor = color
              }
            }
          })

          if (!bestColor) {
            let maxGeneric = -1
            Object.entries(currentDemands).forEach(([color, demandMap]) => {
              const total = Object.values(demandMap).reduce((a, b) => a + b, 0)
              if (total > maxGeneric) { maxGeneric = total; bestColor = color }
            })
          }

          if (bestColor) {
            colorAllocations[bestColor].layers += 1
            remainingLayers--
            Object.entries(best.ratio).forEach(([sz, r]) => {
              currentDemands[bestColor][sz] = (currentDemands[bestColor][sz] || 0) - r
            })
          } else {
            break
          }
        }

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

        if (planRows.length > 0) {
          plans.push({
            id: cutNo++,
            shrinkage: `${lotGroup.mold} | LOT: ${lotGroup.lot}`,
            lot: lotGroup.lot,
            mold: lotGroup.mold,
            totalLayers: best.targetLayers,
            markerRatio: best.ratio,
            markerLength: best.markerLen.toFixed(2),
            rows: planRows,
            fabrics: lotGroup.fabrics.map(f => f.topNo).join(', '),
            note: `Reason: ${best.selectionReason} | Saved: ${Math.floor(best.score / 3000)}`
          })

          lotMetraj -= (best.targetLayers * best.markerLen)
        } else {
          break
        }
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
