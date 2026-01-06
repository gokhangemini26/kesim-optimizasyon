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

          // ========== TOP-DOWN LAYER SEARCH ALGORITHM ==========
          // Goal: Find the best cut (highest layers * most sizes)
          // Method: For each layer count from 80 down, check 4/3/2/1 size combinations

          let best = null

          // Helper: Check if a size combination can support N layers
          const canSupportLayers = (sizes, targetLayers) => {
            for (const s of sizes) {
              if ((colorDemand[s] || 0) < targetLayers) return false
            }
            return true
          }

          // Helper: Calculate marker length for a combination
          const calcMarkerLen = (sizes) => {
            let len = 0
            sizes.forEach(s => {
              const cons = (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption
              len += cons
            })
            return len
          }

          // Helper: Generate all N-size combinations from available sizes
          const getCombinations = (arr, n) => {
            if (n === 1) return arr.map(x => [x])
            if (n > arr.length) return []
            const result = []
            for (let i = 0; i <= arr.length - n; i++) {
              const head = arr[i]
              const tailCombos = getCombinations(arr.slice(i + 1), n - 1)
              tailCombos.forEach(combo => result.push([head, ...combo]))
            }
            return result
          }

          // Sort sizes by demand (highest first) for better combinations
          const sortedSizes = [...colorSizes].sort((a, b) =>
            (colorDemand[b] || 0) - (colorDemand[a] || 0)
          )

          // COLLECT ALL VALID COMBINATIONS
          // Then pick the one with MOST TOTAL PIECES (layers × sizes)
          const allValidCuts = []

          for (let sizeCount = Math.min(4, sortedSizes.length); sizeCount >= 1; sizeCount--) {
            const combos = getCombinations(sortedSizes, sizeCount)

            for (const combo of combos) {
              // Find max layers this combo can support
              let maxLayersDemand = Infinity
              for (const s of combo) {
                maxLayersDemand = Math.min(maxLayersDemand, colorDemand[s] || 0)
              }
              if (maxLayersDemand === 0) continue

              // Check fabric constraint
              const markerLen = calcMarkerLen(combo)
              if (markerLen === 0) continue
              const maxLayersFabric = Math.floor(lotMetraj / markerLen)

              const targetLayers = Math.min(HARD_CAP, maxLayersDemand, maxLayersFabric)
              if (targetLayers <= 0) continue

              const totalPieces = combo.length * targetLayers

              const ratio = {}
              combo.forEach(s => ratio[s] = 1)

              allValidCuts.push({
                group: combo,
                ratio,
                markerLen,
                targetLayers,
                totalPieces,
                sizeCount: combo.length,
                selectionReason: `${combo.length}x @ ${targetLayers}L`
              })
            }
          }

          // SELECTION: Pick by TOTAL PIECES (primary), then LAYER COUNT (tiebreaker)
          if (allValidCuts.length > 0) {
            allValidCuts.sort((a, b) => {
              // Primary: Most total pieces
              if (b.totalPieces !== a.totalPieces) return b.totalPieces - a.totalPieces
              // Tiebreaker: More layers
              if (b.targetLayers !== a.targetLayers) return b.targetLayers - a.targetLayers
              // Tiebreaker: More sizes
              return b.sizeCount - a.sizeCount
            })
            best = allValidCuts[0]
          }

          // If no valid cut found with normal search, allow 1-layer cleanup
          if (!best && totalColorDemand > 0 && lotMetraj > 0) {
            // Cleanup: Just take whatever we can
            for (const s of sortedSizes) {
              const demand = colorDemand[s] || 0
              if (demand > 0) {
                const cons = (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption
                const maxFabric = Math.floor(lotMetraj / cons)
                const layers = Math.min(demand, maxFabric, HARD_CAP)
                if (layers > 0) {
                  best = {
                    group: [s],
                    ratio: { [s]: 1 },
                    markerLen: cons,
                    targetLayers: layers,
                    totalPieces: layers,
                    selectionReason: 'Cleanup'
                  }
                  break
                }
              }
            }
          }

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
