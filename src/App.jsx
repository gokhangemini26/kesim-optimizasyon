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

    // ✅ 4. SCORING ENGINE OPTIMİZASYONU (Gelişmiş Algoritma)
    const sortedColors = Object.keys(colorDemands)

    sortedColors.forEach(color => {
      // Renk bedenlerini sırala (Küçükten büyüğe)
      // Bu sıralama kombinasyon üretirken önemli
      const colorSizes = Object.keys(colorDemands[color]).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      )

      let loopSafety = 0
      while (loopSafety++ < 500) {
        // 1. Kumaş Kontrolü
        const viableGroups = allFabricGroups.filter(g => g.totalMetraj > 0)
        if (viableGroups.length === 0) break

        // En büyük grubu seç
        viableGroups.sort((a, b) => b.totalMetraj - a.totalMetraj)
        const currentGroup = viableGroups[0]

        // 2. Talep Kontrolü
        const currentDemands = remainingDemands[color]
        const totalRemaining = Object.values(currentDemands).reduce((a, b) => a + b, 0)
        if (totalRemaining <= 0) break

        // 3. ADAY KOMBİNASYONLARIN OLUŞTURULMASI (Candidate Generation)
        // Sadece talebi olan bedenleri al
        const activeSizes = colorSizes.filter(s => currentDemands[s] > 0)
        if (activeSizes.length === 0) break

        const candidates = []

        // A. TEKLİ (SAME) - [S], [M]
        activeSizes.forEach(s => candidates.push([s]))

        // B. İKİLİ (PAIR) - [S, M], [S, S]
        for (let i = 0; i < activeSizes.length; i++) {
          for (let j = i; j < activeSizes.length; j++) {
            candidates.push([activeSizes[i], activeSizes[j]])
          }
        }

        // C. ÜÇLÜ (TRIPLE) - [S, M, L]
        // Tüm olası 3'lü kombinasyonları ekle
        for (let i = 0; i < activeSizes.length; i++) {
          for (let j = i; j < activeSizes.length; j++) {
            for (let k = j; k < activeSizes.length; k++) {
              candidates.push([activeSizes[i], activeSizes[j], activeSizes[k]])
            }
          }
        }

        // D. DÖRTLÜ (QUAD) - [S, M, L, XL]
        // En çok talep edilen 4 bedenin kombinasyonu
        if (activeSizes.length >= 4) {
          const topSizes = activeSizes.sort((a, b) => currentDemands[b] - currentDemands[a]).slice(0, 4)
          candidates.push([...topSizes])
        }
        // Ayrıca manuel olarak ilk 4'lü kombinasyonu da ekleyelim (sıralı gelen)
        if (activeSizes.length >= 4) {
          candidates.push(activeSizes.slice(0, 4))
        }

        // 4. SKORLAMA (SCORING)
        let bestCandidate = null
        let bestScore = -Infinity

        candidates.forEach(candidateSizes => {
          // REÇETE SEÇİMİ (Recipe Selection)
          let ratio = {}
          let type = ''

          const uniqueSizes = [...new Set(candidateSizes)]
          const sizeCount = uniqueSizes.length

          if (sizeCount === 1) {
            // Same size -> 4x (Tek bedenden 4 tane, veya 1 tane * 4 kat gibi düşünülür ama markerde 4 adet olması fireyi azaltır)
            // Ancak basitlik için: Her bedenden 1 tane koyup katı artırmak daha kolaydır.
            // Fakat "Pattern Recipe" kuralına göre:
            // Marker'da o bedenden kaç kopya olacağı.
            ratio = { [candidateSizes[0]]: 4 }
            type = 'SAME (4x)'
          } else if (sizeCount === 2) {
            // 2 Beden -> 2+2
            ratio = { [uniqueSizes[0]]: 2, [uniqueSizes[1]]: 2 }
            type = 'PAIR (2+2)'
          } else if (sizeCount === 3) {
            // 3 Beden -> 1+1+1 (Belki en çok istenenden +1 eklenebilir ama standart 1-1-1)
            // Kullanıcı isteği: Mixed 2+1+1 (En çok istenenden 2)
            // En çok talep edilen hangisi?
            const maxDemandSize = uniqueSizes.sort((a, b) => currentDemands[b] - currentDemands[a])[0]
            ratio = {}
            uniqueSizes.forEach(s => ratio[s] = (s === maxDemandSize ? 2 : 1))
            type = 'TRIPLE (2+1+1)'
          } else {
            // 4 Beden -> 1+1+1+1
            ratio = {}
            candidateSizes.forEach(s => ratio[s] = 1)
            type = 'QUAD (1x4)'
          }

          // HESAPLAMALAR
          let currentLength = 0
          let totalPiecesPerLayer = 0
          Object.entries(ratio).forEach(([s, r]) => {
            currentLength += getConsumption(s) * r
            totalPiecesPerLayer += r
          })

          if (currentLength === 0) return

          const maxLayersFabric = Math.floor(currentGroup.totalMetraj / currentLength)

          let maxLayersDemand = Infinity
          Object.entries(ratio).forEach(([s, r]) => {
            const d = currentDemands[s] || 0
            maxLayersDemand = Math.min(maxLayersDemand, Math.floor(d / r))
          })
          if (maxLayersDemand === 0) maxLayersDemand = 1 // Zorla

          // KAT YÖNETİMİ (Soft Cap)
          // İdeal: 40-65 arası. Max: 80
          // Eğer optimum 50 ise ve biz 80 yapabiliyorsak, 80 yapmak yerine 65'te kesmek daha iyi olabilir (kalite için)
          // Ama işi bitirmek için 80'e çıkmaya izin verilir.
          const SOFT_CAP = 65
          const HARD_CAP = 80

          let targetLayers = Math.min(HARD_CAP, maxLayersFabric, maxLayersDemand)

          // Eğre talep çoksa ve fabric yetiyorsa Soft Cap uygula
          // Sadece çok küçük parçalar kalmasın diye kontrol et
          if (targetLayers > SOFT_CAP) {
            // Eğer 65 yaptığımda kalan parça çok küçük (örn 5 katlık) olacaksa, hepsini 80'de bitirmek daha iyidir.
            // Ama 120 katlık iş varsa 60+60 bölmek iyidir.
            // Şimdilik basit soft cap:
            if (maxLayersDemand > 100) targetLayers = SOFT_CAP
          }

          if (targetLayers <= 0) return

          // SKOR FORMÜLÜ
          // 1. Demand Weight: Ne kadar çok iş eritiyoruz? (Adet bazlı)
          const totalPieces = totalPiecesPerLayer * targetLayers
          const demandScore = totalPieces * 1.0

          // 2. Balance Score: Farklı bedenleri karıştırmak (Pastal verimi ve asorti dengesi)
          const balanceScore = sizeCount * 300 // Çeşit başına 300 puan

          // 3. Efficiency Score: Kat sayısı kullanımı (Soft Cap'e yakınlık ve doluluk)
          // 80 kat idealine ne kadar yakınız?
          const efficiencyScore = (targetLayers / HARD_CAP) * 500

          // 4. Risk Penalty (LOOK AHEAD)
          let riskPenalty = 0
          Object.entries(ratio).forEach(([s, r]) => {
            const remaining = (currentDemands[s] || 0) - (targetLayers * r)
            if (remaining > 0 && remaining < 10) {
              riskPenalty += 1000 // Tehlikeli bölge (Ceza artırıldı)
            }
            if (remaining < 0) {
              riskPenalty += Math.abs(remaining) * 100
            }
          })

          const finalScore = demandScore + balanceScore + efficiencyScore - riskPenalty

          if (finalScore > bestScore) {
            bestScore = finalScore
            bestCandidate = {
              ratio,
              layers: targetLayers,
              length: currentLength,
              type,
              pieces: totalPieces,
              score: finalScore
            }
          }
        })

        if (!bestCandidate) {
          // Uygun aday yoksa bu grubu geç
          currentGroup.totalMetraj = 0
          continue
        }

        // EN İYİ PLANI UYGULA
        const { ratio, layers, length, type } = bestCandidate

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
          note: `${type} - Skor: ${Math.floor(bestCandidate.score)}`
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
