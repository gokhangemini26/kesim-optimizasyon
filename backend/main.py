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
    id: int
    color: str
    quantities: Dict[str, int] # { "32": 100, "34": 200 }

class FabricLot(BaseModel):
    id: str
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
        if not lots: continue
        
        # Sort lots descending
        lots.sort(key=lambda x: x['totalMetraj'], reverse=True)
        
        current_lot_idx = 0
        
        # While we have lots and demand
        while current_lot_idx < len(lots):
            # Check global remaining demand
            total_needed = 0
            for c in demands:
                for s in demands[c]:
                    rem = demands[c][s]['demand'] - demands[c][s]['produced'] + demands[c][s]['tolerance']
                    if rem > 0: total_needed += 1
            if total_needed == 0: break
            
            # --- Step A: Generate Candidate Patterns (Markers) ---
            # Generate valid size combinations that fit within constraints (max length usually defined by table, say 10m-20m or simpler logic)
            # OR-Tools CSP (Cutting Stock Problem) Formulation
            
            # Simplified approach for "Marker Generation" embedded in a greedy-with-solver loop:
            # We select a subset of active demands to form a marker.
            
            # 1. Gather active requirements
            active_reqs = [] # (color, size, remaining_need, tolerance_room)
            for color, sizes in demands.items():
                for size, info in sizes.items():
                    rem = info['demand'] - info['produced']
                    tol = info['tolerance']
                    # Effective max we can take now
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

            # 2. Create Solver for ONE Marker Optimization
            # Goal: Find a Marker (ratio of sizes) and a Layer count that fits into available Lot(s)
            # and maximizes "Priority" (Real demand) validation.

            # Heuristic: Filter for sizes that actually match current lot's potential? 
            # (Assuming all colors in mold group are compatible with lot)
            
            # Let's use the SCIP solver to find best pattern * layers for the current head lot(s).
            # We treat the available sequential lots as a seamless resource for this cut.
            
            # Calculate available metraj in current Lot sequence
            # (Limitation: Marker length cannot exceed LOT length if we don't splice. 
            #  User said "Hangi kumas topunu kullaniyorsa...". 
            #  Ideally we assume we can run continuously or we are limited by table length usually 6-10m.
            #  Let's assume max marker length is 10m for physical table constraint)
            MAX_MARKER_LEN = 12.0 
            
            # Try to build a production plan using the biggest available continuous chunk? 
            # Actually, standard industry practice: Marker is prepared (e.g. 5m). 
            # Can be laid on Lot 1 (100m) -> 20 layers.
            
            solver = pywraplp.Solver.CreateSolver('SCIP')
            if not solver: 
                print("SCIP solver not found")
                break

            # Variables: Count of each (Color, Size) in the Marker
            # We limit total marker length <= MAX_MARKER_LEN
            # We limited total pieces in marker (e.g. < 8 usually for table handling)
            
            x = {} # x[color, size] = count in marker
            for req in active_reqs:
                k = (req['color'], req['size'])
                x[k] = solver.IntVar(0, 5, f"x_{req['color']}_{req['size']}") # Max 5 of same size in one marker

            # Constraint: Marker Length <= MAX_MARKER_LEN
            marker_len_expr = solver.Sum([x[(r['color'], r['size'])] * avg_cons for r in active_reqs])
            solver.Add(marker_len_expr <= MAX_MARKER_LEN)
            solver.Add(marker_len_expr >= avg_cons) # Must create at least 1 piece

            # Constraint: Marker Count <= 8 (Visual/Handling constraint)
            # solver.Add(solver.Sum(x.values()) <= 8)
            
            # Objective: Maximize Value
            # Value = Priority (Real Demand) * Count
            objective = solver.Objective()
            for req in active_reqs:
                k = (req['color'], req['size'])
                objective.SetCoefficient(x[k], req['priority'])
            objective.SetMaximization()

            status = solver.Solve()

            if status != pywraplp.Solver.OPTIMAL:
                print("No optimal marker found")
                break
                
            # Extract Best Marker
            best_marker_ratio = {} # { "32": 2, "34": 1 } 
            best_marker_colors = set()
            total_ratio_count = 0
            
            # We need to ensure Single Lot Per Color Constraint?
            # It's hard to enforce "Single Lot" inside "Marker Gen" if we don't know layers yet.
            # "Single Lot" means: Try not to mix colors in the same marker if they are destined for different lots?
            # NO. "Single Lot" means Color A should come from Lot 1. Color B from Lot 1. 
            # If Lot 1 finishes, color A shouldn't jump to Lot 2 if possible.
            # BUT efficient markers MIX colors.
            # User sample shows: "Kesim 1: 32,32... (Red)" -> Only Red.
            # So markers are usually MONO-COLOR or Compatible Colors.
            
            # Let's enforce: Marker should be MONO-COLOR (or very few colors) to favor sorting?
            # User sample: "Renk: 305+825..." -> Multiple colors in one Cut Plan!
            # BUT user said: "Dikkat edersen, her renk, sadece bir lot ile kesilmis."
            # This means multiple colors can be in the same "Cut JOB" (Pastal), 
            # provided they are cut from the SAME layers of the SAME lot. 
            # So mixing colors in a marker is OK, provided that Lot 1 has enough layers for ALL those colors.
            
            current_marker_len = 0
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

            if total_ratio_count == 0: break
            
            # --- Step B: Calculate Max Layers possible with this Marker from CURRENT Lots ---
            # We consume lots sequentially starting from current_lot_idx
            
            # 1. Determine Max Layers allowed by DEMAND (for the items in marker)
            # We are constrained by the item with the LEAST remaining demand coverage
            max_Demandlibs_layers = 10000
            
            # Group chosen items by color to verify demand
            # Issue: If Red-32 (2 needs) and Red-34 (50 needs) are in marker. 
            # Layers limited by Red-32? No, we have tolerance.
            # If Red-32 demand is 2, and we have 1 in marker -> 2 layers ok. 3rd layer is waste (or tol).
            
            # Let's calculate demand for this specific marker configuration
            # Marker: { Red-32: 1, Red-34: 0, Blue-32: 0... }
            
            # To simplify: We just want to fill as much as possible.
            # Let's find how many layers we can cut before hitting Constraint of ANY color
            
            # Actually, we should determine layers based on Lot capacity mainly,
            # and let the demand 'fill up' or 'overfill' slightly.
            
            lot = lots[current_lot_idx]
            max_lot_layers = math.floor(lot['remainingMetraj'] / current_marker_len)
            
            if max_lot_layers == 0:
                # This marker is too big for current residue of lot?
                # Move to next lot or try smaller marker?
                # For now simplify: Move next lot
                current_lot_idx += 1
                continue
                
            # Limit layers by Demand?
            # Check how many layers perfectly satisfy need
            # We want to stop when ALL items in marker are satisfied? Or ANY?
            # Ideally: Stop when the 'primary' reason for this marker is satisfied.
            
            demand_limit_layers = 80 # Table limit
            
            # Check each component consumption
            # For each color/size in marker:
            #   MaxLayers = (Rem + Tol) / CountInMarker
            
            for req in chosen_items:
                count_in_marker = 0
                # re-count specific req (should match x val key)
                # ... simplifies ...
                pass
            
            # Simple check:
            min_layers_to_sat = 10000
            max_layers_to_tol = 0
            
            limit_by_component = []
            for req in active_reqs: # Iterate all potential logic
                 val = int(x[(req['color'], req['size'])].solution_value())
                 if val > 0:
                     rem = req['rem']
                     tol = req['tol']
                     
                     # Layers to finish exact demand
                     if rem > 0:
                        l_exact = math.ceil(rem / val)
                        limit_by_component.append(l_exact)
                     
                     # Layers to Max Tolerance
                     l_max = math.floor((rem + tol) / val)
                     # We must not exceed l_max substantially
                     # But valid patterns might mix high demand and low demand.
            
            if limit_by_component:
                # We usually want to satisfy the "lowest common denominator" of need without overproducing?
                # Or run as long as the "highest need"?
                # Standard: Run until first constraint hit (min of maxes), 
                # OR if it's a mix, maybe separate cut.
                # Let's be aggressive: Run up to max lot capacity or table limit (80)
                # but capped by the logic of "Don't produce waste".
                
                # Check limiting factor
                cap_demand = 100000
                for req in active_reqs:
                     val = int(x[(req['color'], req['size'])].solution_value())
                     if val > 0:
                         max_for_this = (req['rem'] + req['tol']) / val
                         if max_for_this < cap_demand: cap_demand = max_for_this
                
                demand_limit_layers = min(80, math.floor(cap_demand))
            
            # Final Layers
            actual_layers = min(max_lot_layers, demand_limit_layers)
            
            if actual_layers <= 0:
                # Demand satisfied or no space
                break

            # --- Step C: execute Cut ---
            
            # Deduct from Lot
            used_m = actual_layers * current_marker_len
            lot['remainingMetraj'] -= used_m
            
            # Deduct from Demand
            row_quantities = {}
            row_colors = list(best_marker_colors)
            color_str = "+".join(sorted(row_colors))

            # Store plan details
            processed_rows = []
            
            # We need to itemize per color for the chart??
            # The chart shows "Colors: Red, Blue". 
            # Frontend expects `rows` array.
            
            # Calculate quantities
            for req in active_reqs:
                val = int(x[(req['color'], req['size'])].solution_value())
                if val > 0:
                    qty = val * actual_layers
                    # Update demand
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
            
            # Check if lot empty
            if lot['remainingMetraj'] < 1.0: # Close to empty
                current_lot_idx += 1
    
    return plans

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
