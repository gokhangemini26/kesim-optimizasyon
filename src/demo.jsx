import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ResultsView from './components/optimization/ResultsView'
import { generateSummary } from './utils/OptimizationEngine'
import { solveAsorti } from './utils/asortiClient'
import { orderRows, fabricRows, humanAllocation, params } from '../test/fixtures/ornek-1sa100.js'
import './index.css'

function Demo() {
    const [state, setState] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        solveAsorti({
            orderRows,
            fabricRows,
            consumptionMode: params.consumptionMode,
            avgConsumption: params.avgConsumption,
            sizeConsumptions: params.sizeConsumptions,
            allocationOverride: humanAllocation
        }).then(res => {
            const summary = generateSummary(orderRows, res.plans, res.integrityMap)
            setState({
                plans: res.plans,
                summary: {
                    summary,
                    metrajInfo: {
                        initial: res.stats.availableMetraj.toFixed(2),
                        used: res.stats.usedMetraj.toFixed(2),
                        remaining: (res.stats.availableMetraj - res.stats.usedMetraj).toFixed(2),
                        usagePercent: res.stats.utilization
                    },
                    asortiMatrix: res.asortiMatrix,
                    allocation: res.allocation,
                    stats: res.stats
                }
            })
        }).catch(e => setError(e.message))
    }, [])

    if (error) return <div className="p-12 text-red-600 font-black text-xl">MOTOR HATASI: {error}</div>
    if (!state) return <div className="p-12 font-black text-xl text-slate-500">Asorti motoru çalışıyor… (300 senaryo)</div>
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <ResultsView plans={state.plans} summary={state.summary} onBack={() => window.location.reload()} />
        </div>
    )
}

createRoot(document.getElementById('root')).render(<Demo />)
