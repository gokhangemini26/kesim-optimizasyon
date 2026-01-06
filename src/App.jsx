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

    // ========== REVERSE PYRAMID GLOBAL OPTIMIZATION ==========
    // Phase 1: Single-color deep cuts (80×4 → 1×1)
    // Phase 2: Multi-color cleanup (last resort)

    const calcMarkerLen = (sizes) => {
      let len = 0
      sizes.forEach(s => {
        const cons = (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption
        len += cons
      })
      return len
    }

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

    // Get all unique sizes across all colors
    const optAllSizes = [...new Set(Object.values(currentDemands).flatMap(d => Object.keys(d)))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))

    // PHASE 1: Single-color optimization with Reverse Pyramid
    let loopSafety = 0
    while (loopSafety++ < 500) {
      // Find the best cut across ALL colors
      let globalBest = null

      // Iterate through colors to find the best single-color cut
      Object.entries(currentDemands).forEach(([color, colorDemand]) => {
        const colorSizes = Object.keys(colorDemand).filter(s => colorDemand[s] > 0)
        if (colorSizes.length === 0) return

        // Try ALL lots, not just the first one
        fabricLots.forEach(lot => {
          if (lot.totalMetraj <= 0) return

          // Reverse Pyramid: Start from MAX (80×4=320) and work down
          // Collect all valid cuts, then pick the best
          for (let sizeCount = Math.min(4, colorSizes.length); sizeCount >= 1; sizeCount--) {
            const combos = getCombinations(colorSizes, sizeCount)

            for (const combo of combos) {
              // Find max layers this combo can support from demand
              let maxLayersDemand = Infinity
              for (const s of combo) {
                maxLayersDemand = Math.min(maxLayersDemand, colorDemand[s] || 0)
              }
              if (maxLayersDemand === 0) continue

              // Check fabric constraint for THIS lot
              const markerLen = calcMarkerLen(combo)
              if (markerLen === 0) continue
              const maxLayersFabric = Math.floor(lot.totalMetraj / markerLen)

              const targetLayers = Math.min(HARD_CAP, maxLayersDemand, maxLayersFabric)
              if (targetLayers <= 0) continue

              const totalPieces = combo.length * targetLayers

              const candidate = {
                color,
                lot,
                group: combo,
                ratio: Object.fromEntries(combo.map(s => [s, 1])),
                markerLen,
                targetLayers,
                totalPieces,
                sizeCount: combo.length
              }

              if (!globalBest || totalPieces > globalBest.totalPieces) {
                globalBest = candidate
              }
            }
          }
        })
      })

      if (!globalBest) break // No more single-color cuts possible

      // EXECUTE the best cut
      const { color, lot, group, ratio, markerLen, targetLayers, totalPieces } = globalBest

      const producedQuantities = {}
      group.forEach(sz => {
        const qty = targetLayers
        producedQuantities[sz] = qty
        currentDemands[color][sz] = Math.max(0, (currentDemands[color][sz] || 0) - qty)
      })

      const usedMetraj = targetLayers * markerLen
      lot.totalMetraj -= usedMetraj

      plans.push({
        id: cutNo++,
        shrinkage: `${lot.mold} | LOT: ${lot.lot}`,
        lot: lot.lot,
        mold: lot.mold,
        totalLayers: targetLayers,
        markerRatio: ratio,
        markerLength: markerLen.toFixed(2),
        rows: [{
          colors: color,
          layers: targetLayers,
          quantities: producedQuantities
        }],
        fabrics: lot.fabrics.map(f => f.topNo).join(', '),
        note: `Phase1: ${group.length}x @ ${targetLayers}L = ${totalPieces}pcs`
      })
    }

    // PHASE 2: Multi-color cleanup (last resort)
    // Consolidate remaining small demands across colors
    loopSafety = 0
    while (loopSafety++ < 200) {
      // Consolidate remaining demand across all colors
      const globalDemand = {}
      Object.entries(currentDemands).forEach(([color, colorDemand]) => {
        Object.entries(colorDemand).forEach(([sz, qty]) => {
          if (qty > 0) {
            if (!globalDemand[sz]) globalDemand[sz] = { total: 0, colors: [] }
            globalDemand[sz].total += qty
            globalDemand[sz].colors.push({ color, qty })
          }
        })
      })

      const remainingSizes = Object.keys(globalDemand).filter(s => globalDemand[s].total > 0)
      if (remainingSizes.length === 0) break

      const availableLot = fabricLots.find(lot => lot.totalMetraj > 0)
      if (!availableLot) break

      // Find best multi-color cut
      let best = null
      const validCuts = []

      for (let sizeCount = Math.min(4, remainingSizes.length); sizeCount >= 1; sizeCount--) {
        const combos = getCombinations(remainingSizes, sizeCount)

        for (const combo of combos) {
          // Max layers = min of total demand across combo sizes
          let maxLayersDemand = Infinity
          for (const s of combo) {
            maxLayersDemand = Math.min(maxLayersDemand, globalDemand[s].total)
          }
          if (maxLayersDemand === 0) continue

          const markerLen = calcMarkerLen(combo)
          if (markerLen === 0) continue
          const maxLayersFabric = Math.floor(availableLot.totalMetraj / markerLen)

          const targetLayers = Math.min(HARD_CAP, maxLayersDemand, maxLayersFabric)
          if (targetLayers <= 0) continue

          validCuts.push({
            lot: availableLot,
            group: combo,
            markerLen,
            targetLayers,
            totalPieces: combo.length * targetLayers
          })
        }
      }

      if (validCuts.length === 0) break

      validCuts.sort((a, b) => b.totalPieces - a.totalPieces)
      best = validCuts[0]

      // Distribute layers to colors proportionally
      const planRows = []
      let remainingLayers = best.targetLayers

      best.group.forEach(sz => {
        const sizeColors = globalDemand[sz].colors.sort((a, b) => b.qty - a.qty)
        let layersForSize = best.targetLayers

        sizeColors.forEach(({ color, qty }) => {
          if (layersForSize <= 0) return
          const layersToUse = Math.min(qty, layersForSize)

          // Find or create row for this color
          let row = planRows.find(r => r.colors === color)
          if (!row) {
            row = { colors: color, layers: 0, quantities: {} }
            planRows.push(row)
          }
          row.quantities[sz] = (row.quantities[sz] || 0) + layersToUse
          row.layers = Math.max(row.layers, layersToUse)

          currentDemands[color][sz] = Math.max(0, currentDemands[color][sz] - layersToUse)
          layersForSize -= layersToUse
        })
      })

      const usedMetraj = best.targetLayers * best.markerLen
      best.lot.totalMetraj -= usedMetraj

      plans.push({
        id: cutNo++,
        shrinkage: `${best.lot.mold} | LOT: ${best.lot.lot}`,
        lot: best.lot.lot,
        mold: best.lot.mold,
        totalLayers: best.targetLayers,
        markerRatio: Object.fromEntries(best.group.map(s => [s, 1])),
        markerLength: best.markerLen.toFixed(2),
        rows: planRows,
        fabrics: best.lot.fabrics.map(f => f.topNo).join(', '),
        note: `Phase2 (MultiColor): ${best.group.length}x @ ${best.targetLayers}L`
      })
    }

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
