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
    const { orderRows, groupingResults, avgConsumption, consumptionMode, sizeConsumptions } = data

    if (!groupingResults || !groupingResults.allGroups || groupingResults.allGroups.length === 0) {
      alert("Lütfen kumaşları gruplandırın!")
      return
    }

    // ✅ 1. TALEPLERİ HAZIRLA (Renk bazlı birleştir)
    const aggregatedDemands = {}

    orderRows.forEach(row => {
      if (!row.color || row.color.trim() === '') return

      if (!aggregatedDemands[row.color]) {
        aggregatedDemands[row.color] = {}
      }

      Object.entries(row.quantities).forEach(([size, qty]) => {
        const val = parseInt(qty) || 0
        if (val > 0) {
          aggregatedDemands[row.color][size] = (aggregatedDemands[row.color][size] || 0) + val
        }
      })
    })

    // ✅ 2. %5 FAZLA EKLE (Toplam talep üzerinden)
    const colorDemands = {}

    Object.entries(aggregatedDemands).forEach(([color, quantities]) => {
      colorDemands[color] = {}
      const totalDemand = Object.values(quantities).reduce((a, b) => a + b, 0)

      // Toplamın %5'i
      const extraTotal = Math.ceil(totalDemand * 0.05)

      const sizes = Object.keys(quantities)
      if (sizes.length === 0) return

      // Eşit dağıtım
      const extraPerSize = Math.floor(extraTotal / sizes.length)
      const remainder = extraTotal % sizes.length

      sizes.forEach((size, idx) => {
        const baseDemand = quantities[size] || 0
        const extra = extraPerSize + (idx < remainder ? 1 : 0)
        colorDemands[color][size] = baseDemand + extra
      })
    })

    console.log('📊 Toplam Talepler (+%5 Dahil):', colorDemands)

    // ✅ 3. TÜKETİM DEĞERLERİNİ HAZIRLA
    const getConsumption = (size) => {
      if (consumptionMode === 'SIZE') {
        return parseFloat(sizeConsumptions[size]) || avgConsumption
      }
      return avgConsumption
    }

    // ✅ 3. KUMAŞ GRUPLARINI BİRLEŞTİR
    // groupingResults 'Smart Grouping' ile sadece en uyumlu olanı kalip1'e koyuyor
    const allFabricGroups = [
      ...groupingResults.kalip1.map(g => ({ ...g, mold: 'KALIP - 1' })),
      ...groupingResults.kalip2.map(g => ({ ...g, mold: 'KALIP - 2' }))
    ]

    const plans = []
    let cutNo = 1
    const remainingDemands = JSON.parse(JSON.stringify(colorDemands))

    // ✅ 4. RENK BAZLI OPTİMİZASYON (Önce tek renk-tek lot)
    const colors = Object.keys(colorDemands)

    colors.forEach(color => {
      const colorSizes = Object.keys(colorDemands[color]).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      )

      // Bu renk için toplam talep
      let colorTotalRemaining = Object.values(remainingDemands[color]).reduce((a, b) => a + b, 0)

      // ✅ 5. HER KUMAŞ GRUBUNU DENE (En büyük metrajdan başla)
      allFabricGroups.forEach(fabricGroup => {
        if (colorTotalRemaining <= 0) return // Bu renk tamamlandı

        const { lot, fabrics, totalMetraj, mold } = fabricGroup

        // ✅ 6. MARKER RATIO OLUŞTUR (Talebe göre oransal)
        const markerRatio = {}
        let totalRatioUnits = 0

        colorSizes.forEach(size => {
          const demand = remainingDemands[color][size] || 0
          if (demand > 0) {
            markerRatio[size] = 1 // Basit: Her bedenden 1'er
            totalRatioUnits += 1
          }
        })

        if (totalRatioUnits === 0) return

        // ✅ 7. MARKER UZUNLUĞU HESAPLA
        let markerLength = 0
        Object.entries(markerRatio).forEach(([size, count]) => {
          markerLength += getConsumption(size) * count
        })

        if (markerLength === 0) return

        // ✅ 8. MAKSİMUM KAT SAYISI
        const maxLayersByFabric = Math.floor(totalMetraj / markerLength)

        // Her beden için minimum kat sayısı
        let maxLayersByDemand = Infinity
        Object.entries(markerRatio).forEach(([size, ratio]) => {
          const demand = remainingDemands[color][size] || 0
          const layersNeeded = Math.ceil(demand / ratio)
          maxLayersByDemand = Math.min(maxLayersByDemand, layersNeeded)
        })

        const totalLayers = Math.min(80, maxLayersByFabric, maxLayersByDemand)

        if (totalLayers <= 0) return

        // ✅ 9. ÜRETİLEN ADETLERİ HESAPLA VE TALEBİ GÜNCELLE
        const producedQuantities = {}

        Object.entries(markerRatio).forEach(([size, ratio]) => {
          const produced = totalLayers * ratio
          producedQuantities[size] = produced

          // Talebi düş
          remainingDemands[color][size] = Math.max(0, remainingDemands[color][size] - produced)
        })

        // ✅ 10. PLANI KAYDET
        plans.push({
          id: cutNo++,
          shrinkage: `${mold} | LOT: ${lot}`,
          lot: lot,
          mold: mold,
          totalLayers: totalLayers,
          markerRatio: markerRatio,
          markerLength: markerLength.toFixed(2),
          rows: [{
            colors: color,
            layers: totalLayers,
            quantities: producedQuantities
          }],
          fabrics: fabrics.map(f => f.topNo).join(', '),
          usedMetraj: (totalLayers * markerLength).toFixed(2),
          availableMetraj: totalMetraj.toFixed(2),
          remainingMetraj: (totalMetraj - totalLayers * markerLength).toFixed(2)
        })

        // Kalan talebi güncelle
        colorTotalRemaining = Object.values(remainingDemands[color]).reduce((a, b) => a + b, 0)
      })
    })

    // ✅ 11. EKSİK KALAN TALEPLERİ TOPLA (Çok renkli kesim planları)
    const hasRemainingDemands = Object.values(remainingDemands).some(colorDemand =>
      Object.values(colorDemand).some(qty => qty > 0)
    )

    if (hasRemainingDemands) {
      console.log('⚠️ Eksik talepler var, çok renkli kesim planı oluşturuluyor...')

      // Kalan kumaşları kullan
      allFabricGroups.forEach(fabricGroup => {
        const { lot, fabrics, totalMetraj, mold } = fabricGroup

        // Hangi renklerde talep var?
        const colorsWithDemand = Object.keys(remainingDemands).filter(color =>
          Object.values(remainingDemands[color]).some(qty => qty > 0)
        )

        if (colorsWithDemand.length === 0) return

        // Tüm bedenleri topla
        const allSizes = new Set()
        colorsWithDemand.forEach(color => {
          Object.keys(remainingDemands[color]).forEach(sz => {
            if (remainingDemands[color][sz] > 0) {
              allSizes.add(sz)
            }
          })
        })

        const sizesArray = Array.from(allSizes).sort((a, b) =>
          String(a).localeCompare(String(b), undefined, { numeric: true })
        )

        if (sizesArray.length === 0) return

        // Marker ratio
        const markerRatio = {}
        sizesArray.forEach(size => {
          markerRatio[size] = 1
        })

        // Marker length
        let markerLength = 0
        sizesArray.forEach(size => {
          markerLength += getConsumption(size)
        })

        const maxLayersByFabric = Math.floor(totalMetraj / markerLength)

        // Her renk için ayrı satır
        const planRows = []
        let totalLayersUsed = 0

        colorsWithDemand.forEach(color => {
          let minLayers = Infinity

          sizesArray.forEach(size => {
            const demand = remainingDemands[color][size] || 0
            if (demand > 0) {
              minLayers = Math.min(minLayers, Math.ceil(demand / (markerRatio[size] || 1)))
            }
          })

          if (minLayers === Infinity || minLayers <= 0) return

          const colorLayers = Math.min(minLayers, maxLayersByFabric - totalLayersUsed)

          if (colorLayers > 0) {
            const producedQuantities = {}

            sizesArray.forEach(size => {
              const produced = colorLayers * (markerRatio[size] || 0)
              producedQuantities[size] = produced

              if (remainingDemands[color][size]) {
                remainingDemands[color][size] = Math.max(0, remainingDemands[color][size] - produced)
              }
            })

            planRows.push({
              colors: color,
              layers: colorLayers,
              quantities: producedQuantities
            })

            totalLayersUsed += colorLayers
          }
        })

        if (planRows.length > 0) {
          plans.push({
            id: cutNo++,
            shrinkage: `${mold} | LOT: ${lot}`,
            lot: lot,
            mold: mold,
            totalLayers: totalLayersUsed,
            markerRatio: markerRatio,
            markerLength: markerLength.toFixed(2),
            rows: planRows,
            fabrics: fabrics.map(f => f.topNo).join(', '),
            usedMetraj: (totalLayersUsed * markerLength).toFixed(2),
            availableMetraj: totalMetraj.toFixed(2),
            remainingMetraj: (totalMetraj - totalLayersUsed * markerLength).toFixed(2)
          })
        }
      })
    }

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
