from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from ortools.linear_solver import pywraplp
from fastapi.middleware.cors import CORSMiddleware
import math
import itertools

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class OrderRow(BaseModel):
    id: int | str | float
    color: str
    quantities: Dict[str, int] # { "32": 100, "34": 200 }

class FabricLot(BaseModel):
    id: str | int
    lot: str
    totalMetraj: float
    remainingMetraj: float
    mold: str
    fabrics: List[Any] = []

class OptimizationRequest(BaseModel):
    orderRows: List[OrderRow]
    groupingResults: Dict[str, List[FabricLot]] # { "kalip1": [...], "kalip2": [...] }
    avgConsumption: float

class CutPlanRow(BaseModel):
    colors: str
    layers: int
    quantities: Dict[str, int]

class CutPlan(BaseModel):
    id: int
    shrinkage: str
    lot: str
    mold: str
    totalLayers: int
    markerRatio: Dict[str, int]
    rows: List[CutPlanRow]
    fabrics: str

@app.get("/")
def read_root():
    return {"status": "Optimization Service Ready"}

@app.post("/optimize", response_model=List[CutPlan])
def optimize_cutting(data: OptimizationRequest):
    print("Received optimization request")
    
    # 1. Parse Input
    avg_cons = data.avgConsumption
    orders = data.orderRows
    
    # Flatten Demands & Calculate Tolerances
    # Structure: { [color]: { [size]: { demand: X, tolerance: Y, produced: 0 } } }
    demands = {}
    all_sizes = set()
    
    for row in orders:
        if row.color not in demands:
            demands[row.color] = {}
        
        for size, qty in row.quantities.items():
            qty = int(qty)
            if qty > 0:
                demands[row.color][size] = {
                    "demand": qty,
                    "tolerance": math.ceil(qty * 0.05),
                    "produced": 0
                }
                all_sizes.add(size)
    
    sorted_sizes = sorted(list(all_sizes), key=lambda x: str(x))

    # 2. Setup Resources (Mold Groups)
    mold_groups = {
        'KALIP - 1': [l.dict() for l in data.groupingResults.get('kalip1', [])],
        'KALIP - 2': [l.dict() for l in data.groupingResults.get('kalip2', [])],
        'KALIP - 3': [l.dict() for l in data.groupingResults.get('kalip3', [])]
    }
    
    plans = []
    cut_id_counter = 1

    # solver = pywraplp.Solver.CreateSolver('SCIP') 
    # Using specific logic wrapper instead of raw MIP for complex bin packing variant
    # because we need multi-stage logic (Pattern Gen -> Bin Packing with variable bins)
    
    # --- Optimization Process ---
    
    for mold_name, lots in mold_groups.items():
        if not lots: 
            print(f"No lots for {mold_name}")
            continue
        
        # Sort lots descending
        lots.sort(key=lambda x: x['totalMetraj'], reverse=True)
        print(f"Processing {mold_name} with {len(lots)} lots. Total Metraj: {sum(l['remainingMetraj'] for l in lots)}")
        
        current_lot_idx = 0
        
        # While we have lots and demand
        while current_lot_idx < len(lots):
            # Check global remaining demand
            total_needed = 0
            for c in demands:
                for s in demands[c]:
                    rem = demands[c][s]['demand'] - demands[c][s]['produced'] + demands[c][s]['tolerance']
                    if rem > 0: total_needed += 1
            
            if total_needed == 0: 
                print("All demand satisfied.")
                break
            
            # --- Step A: Generate Candidate Patterns (Markers) ---
            active_reqs = []
            for color, sizes in demands.items():
                for size, info in sizes.items():
                    rem = info['demand'] - info['produced']
                    tol = info['tolerance']
                    can_take = rem + tol
                    if can_take > 0:
                        active_reqs.append({
                            'color': color, 
                            'size': size, 
                            'rem': rem, 
                            'tol': tol, 
                            'priority': 10 if rem > 0 else 1
                        })
            
            if not active_reqs: break

            print(f"Active reqs count: {len(active_reqs)}")

            # Solver setup
            MAX_MARKER_LEN = 12.0 
            
            solver = pywraplp.Solver.CreateSolver('CBC')
            if not solver: 
                print("CBC solver not found")
                break

            x = {} 
            for req in active_reqs:
                k = (req['color'], req['size'])
                x[k] = solver.IntVar(0, 5, f"x_{req['color']}_{req['size']}") 

            marker_len_expr = solver.Sum([x[(r['color'], r['size'])] * avg_cons for r in active_reqs])
            solver.Add(marker_len_expr <= MAX_MARKER_LEN)
            solver.Add(marker_len_expr >= avg_cons) 

            objective = solver.Objective()
            for req in active_reqs:
                k = (req['color'], req['size'])
                objective.SetCoefficient(x[k], req['priority'])
            objective.SetMaximization()

            status = solver.Solve()

            if status != pywraplp.Solver.OPTIMAL:
                print(f"No optimal marker found. Status: {status}")
                # Try simple marker or break?
                break
            
            # Extract Best Marker
            best_marker_ratio = {} 
            best_marker_colors = set()
            total_ratio_count = 0
            current_marker_len = 0.0
            chosen_items = []
            
            for req in active_reqs:
                k = (req['color'], req['size'])
                val = int(x[k].solution_value())
                if val > 0:
                    best_marker_ratio[req['size']] = best_marker_ratio.get(req['size'], 0) + val
                    best_marker_colors.add(req['color'])
                    current_marker_len += (val * avg_cons)
                    total_ratio_count += val
                    for _ in range(val): chosen_items.append(req)

            if total_ratio_count == 0: 
                print("Total ratio 0. Break.")
                break
            
            print(f"Marker found. Len: {current_marker_len:.2f}m. Items: {best_marker_ratio}")

            # --- Step B: Calculate Layers ---
            lot = lots[current_lot_idx]
            print(f"Current Lot: {lot['lot']}, Rem: {lot['remainingMetraj']:.2f}m")
            
            max_lot_layers = math.floor(lot['remainingMetraj'] / current_marker_len)
            
            if max_lot_layers == 0:
                print("Lot too small for marker. Next lot.")
                current_lot_idx += 1
                continue
                
            # Limit layers by Demand
            demand_limit_layers = 150 # Upper bound
            
            cap_demand = 100000.0
            for req in active_reqs:
                 k = (req['color'], req['size'])
                 val = int(x[k].solution_value())
                 if val > 0:
                     rem = req['rem']
                     tol = req['tol']
                     # Start with max possible
                     # We must produce at least 'something' if we picked it?
                     # No, layers can be limited by the *tightest* constraint.
                     # Max layers we can produce without exceeding (rem + tol)
                     max_for_this = (rem + tol) / val
                     if max_for_this < cap_demand: cap_demand = max_for_this
            
            demand_limit_layers = min(demand_limit_layers, math.floor(cap_demand))
            
            # Final Layers
            actual_layers = min(max_lot_layers, demand_limit_layers)
            print(f"Layers Calc: MaxLot={max_lot_layers}, DemandLimit={demand_limit_layers}, Actual={actual_layers}")
            
            if actual_layers <= 0:
                print("Actual layers 0. Breaking loop (demand or space issue).")
                # Careful: If actual_layers is 0 because demand met? -> Correct.
                # If 0 because lot small? -> Handled earlier.
                # If 0 because cap_demand < 1? -> Means we shouldn't have picked this marker?
                # But active_reqs only includes items with can_take > 0.
                # So cap_demand >= 1/5 = 0.2.
                # math.floor(0.2) = 0.
                # If we need 1 piece, and marker has 5? -> 0 layers?
                # We should allow ceiling if needed?
                # Logic: If we rely on tolerance, we can produce slightly more.
                # But here we are bounded by (rem + tol).
                # If valid marker selected, we *expect* at least 1 layer?
                # Try ceil? No, floor is safe to avoid overproduction > tolerance.
                # If floor gives 0, it means we can't do even 1 layer without violating tolerance?
                # Then we should SKIP this marker attempt and try excluding tight items?
                # For now, just break or continue?
                break

            # --- Step C: execute Cut ---
            
            used_m = actual_layers * current_marker_len
            lot['remainingMetraj'] -= used_m
            
            row_quantities = {}
            row_colors = list(best_marker_colors)
            color_str = "+".join(sorted(row_colors))

            for req in active_reqs:
                k = (req['color'], req['size'])
                val = int(x[k].solution_value())
                if val > 0:
                    qty = val * actual_layers
                    # Update global demands tracking
                    demands[req['color']][req['size']]['produced'] += qty
                    row_quantities[req['size']] = row_quantities.get(req['size'], 0) + qty
            
            current_plan = {
                "id": cut_id_counter,
                "shrinkage": f"{mold_name} | LOT: {lot['lot']}",
                "lot": lot['lot'],
                "mold": mold_name,
                "totalLayers": actual_layers,
                "markerRatio": best_marker_ratio,
                "rows": [{
                   "colors": color_str,
                   "layers": actual_layers,
                   "quantities": row_quantities
                }],
                "fabrics": f"{lot['lot']} ({used_m:.2f}m)"
            }
            plans.append(current_plan)
            cut_id_counter += 1
            print(f"Plan created. ID: {current_plan['id']}")
            
            if lot['remainingMetraj'] < 1.0: 
                current_lot_idx += 1

    
    return plans

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
