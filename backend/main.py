from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Union
from ortools.sat.python import cp_model
from fastapi.middleware.cors import CORSMiddleware
import math
import re
import collections

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models ---

class OrderRow(BaseModel):
    id: Union[int, str, float]
    color: str
    quantities: Dict[str, int] # { "32": 100, "34": 200 }

class FabricRaw(BaseModel):
    id: Union[str, int, float]
    topNo: Union[str, int]
    lot: str
    shrinkageCode: str # "E55 B45"
    metraj: float

class OptimizationRequest(BaseModel):
    orderRows: List[OrderRow]
    fabrics: List[FabricRaw] # Raw list from frontend
    avgConsumption: float

class CutPlanRow(BaseModel):
    colors: str # "Red+Blue", usually single color per requirement
    layers: int
    quantities: Dict[str, int]

class CutPlan(BaseModel):
    id: int
    group_name: str
    used_rolls: List[str] # List of Top Nos
    cut_summary: List[str] # "Renk 305 - 32: 50, 34: 20"
    totalLayers: int
    efficiency: float
    rows: List[CutPlanRow]

# --- Logic Helper ---

def parse_shrinkage(code: str):
    """Parses 'E55 B45' -> En: 5.5, Boy: 4.5"""
    code = code.upper().replace(" ", "")
    en_match = re.search(r'E(\d+\.?\d*)', code)
    boy_match = re.search(r'B(\d+\.?\d*)', code)
    
    en_val = float(en_match.group(1)) if en_match else 0.0
    boy_val = float(boy_match.group(1)) if boy_match else 0.0
    
    # User might input 55 for 5.5% or 5.5 directly. 
    # Usually in textile E55 means 5.5%. E5 means 5%? Or 0.5?
    # Context suggests "E55" -> 5.5%. "E5" -> 5.0%? 
    # Let's assume input matches exactly what is written on roll.
    # Grouping logic depends on delta.
    
    return en_val, boy_val

def are_shrinkages_compatible(s1, s2, tol_en=1.0, tol_boy=1.0):
    e1, b1 = parse_shrinkage(s1)
    e2, b2 = parse_shrinkage(s2)
    return abs(e1 - e2) <= tol_en and abs(b1 - b2) <= tol_boy

# --- Optimization Endpoint ---

@app.post("/optimize", response_model=List[CutPlan])
def optimize_cutting_cp_sat(data: OptimizationRequest):
    print(f"Received Request: {len(data.orderRows)} orders, {len(data.fabrics)} fabrics")
    
    # 1. Parsing & Smart Grouping
    # Group by Lot -> Then Cluster by Shrinkage
    lots = collections.defaultdict(list)
    for f in data.fabrics:
        lots[f.lot].append(f)
        
    fabric_groups = [] # List of { "name": "Lot X - E55 B45", "rolls": [f1, f2], "total_m": ... }
    
    for lot_name, rolls in lots.items():
        # Cluster within lot
        # Simple clustering: Pick pivot, find all compatible, remove, repeat
        remaining_rolls = sorted(rolls, key=lambda x: x.metraj, reverse=True)
        
        while remaining_rolls:
            pivot = remaining_rolls.pop(0)
            cluster = [pivot]
            others = []
            
            for r in remaining_rolls:
                if are_shrinkages_compatible(pivot.shrinkageCode, r.shrinkageCode):
                    cluster.append(r)
                else:
                    others.append(r)
            
            remaining_rolls = others
            
            # Create Group
            total_m = sum(c.metraj for c in cluster)
            fabric_groups.append({
                "id": f"{lot_name}_{len(fabric_groups)}",
                "name": f"Lot {lot_name} / {pivot.shrinkageCode}",
                "rolls": cluster,
                "total_metraj": total_m,
                "used_metraj": 0.0
            })
            
    # 2. Prepare Demand
    # Flatten: (Color, Size) -> target_qty, min_qty, max_qty
    demands = []
    
    for order in data.orderRows:
        for size, qty in order.quantities.items():
            if qty > 0:
                demands.append({
                    "color": order.color,
                    "size": size,
                    "target": qty,
                    "min": qty,
                    "max": math.ceil(qty * 1.05) # 5% Tolerance
                })
    
    if not demands:
        return []

    # 3. CP-SAT Optimization Model
    model = cp_model.CpModel()
    
    # Variables
    # x[demand_idx, group_idx] = quantity allocated to this group
    allocation = {} 
    
    # Track used metraj per group
    # used_m[group_idx] approx = sum(x * avg_cons)
    # We need to enforce group capacity.
    
    # Scaling consumption to integer (mm) for solver stability if needed, 
    # but here quantities are integers. Metraj is float.
    # We can treat capacity constraint as: sum(x) * avg_consumption <= total_metraj
    
    avg_cons = data.avgConsumption
    
    score_vars = []
    
    for d_idx, d in enumerate(demands):
        # We need to decide how many units of this demand come from which group
        
        # Determine total var for this demand
        total_qty_var = model.NewIntVar(d['min'], d['max'], f"total_qty_{d['color']}_{d['size']}")
        
        qty_from_groups = []
        
        # Soft preference: Try to serve a Color from a Single Lot/Group.
        # This is hard. "One color -> One Lot".
        # Let's create boolean vars: is_color_in_group[color, group]
        
        for g_idx, group in enumerate(fabric_groups):
            # Qty of (Color, Size) assigned to Group
            # Upper bound: demand max or group capacity
            max_cap = int(group['total_metraj'] / avg_cons)
            limit = min(d['max'], max_cap)
            
            # Create variable
            x = model.NewIntVar(0, limit, f"x_{d_idx}_{g_idx}")
            allocation[(d_idx, g_idx)] = x
            qty_from_groups.append(x)
            
        # Constraint: Sum of allocations must match total_qty_var
        model.Add(sum(qty_from_groups) == total_qty_var)
        
    # Capacity Constraints per Group
    for g_idx, group in enumerate(fabric_groups):
        # sum(x_d_g * avg_cons) <= total_metraj_g
        # Convert to int inequality: sum(x_d_g) <= total_metraj / avg_cons
        
        max_units = int(group['total_metraj'] / avg_cons)
        
        # Sum of all demands allocated to this group
        group_load_expr = sum(allocation[(d_idx, g_idx)] for d_idx in range(len(demands)))
        model.Add(group_load_expr <= max_units)
        
        # Objective: Maximize Usage? Minimize Waste?
        # We want to satisfy demand within tolerance (handled by bounds).
        # We want to Minimize Split Lots (One color in many lots).
        
    # Single Lot per Color Preference (Soft)
    # Map color -> list of groups used
    all_colors = set(d['color'] for d in demands)
    
    penalties = []
    
    for color in all_colors:
        # Get all demand indices for this color
        d_indices = [i for i, d in enumerate(demands) if d['color'] == color]
        
        # For each group, is this color present?
        groups_used_vars = []
        for g_idx in range(len(fabric_groups)):
            # is_present = 1 if sum(allocation for this color in this group) > 0
            
            qty_in_group = sum(allocation[(di, g_idx)] for di in d_indices)
            is_present = model.NewBoolVar(f"color_{color}_in_g{g_idx}")
            
            # Link constraint: is_present <=> qty_in_group > 0
            # If qty > 0 -> is_present = 1
            # If qty = 0 -> is_present = 0
            model.Add(qty_in_group > 0).OnlyEnforceIf(is_present)
            model.Add(qty_in_group == 0).OnlyEnforceIf(is_present.Not())
            
            groups_used_vars.append(is_present)
            
        # Penalty for using > 1 group
        # Number of groups used for this color
        num_groups_used = model.NewIntVar(0, len(fabric_groups), f"num_groups_{color}")
        model.Add(num_groups_used == sum(groups_used_vars))
        
        # We want num_groups_used to be 1 ideally.
        # Penalty = (num_groups_used - 1) * 1000
        # Since we minimize, we add num_groups_used to objective
        penalties.append(num_groups_used)

    # Objective
    # 1. Minimize Number of "Split Colors" (primary)
    # 2. Maximize Production (within tolerance) ? Usually we assume demands are set.
    #    Actually we want to satisfy Min demand. The 5% is tolerance to FILL fabric if needed.
    #    Let's add a small bonus for production to encourage using tolerance if it helps fit lots?
    #    No, user usually prefers exact unless necessary.
    
    # Let's Minimize: 
    # (Sum of Groups Used per Color * 1000)
    # - (Sum of Total Qty * 1) -> To encourage producing closer to Max? No.
    
    model.Minimize(sum(penalties))
    
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)
    
    print(f"Solver Status: {solver.StatusName(status)}")
    
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print("Optimization failed to find feasible solution.")
        return []
        
    # --- Format Check ---
    # Create Plans based on Allocation
    
    plans = []
    plan_id = 1
    
    for g_idx, group in enumerate(fabric_groups):
        # Gather all items allocated to this group
        group_items = []
        total_layers_dummy = 0 # Layers is a bit abstract here because we allocated Quantity.
        # We can derive "Virtual Layers" if we assume 1 layer = 1 unit? No.
        # In Cut Plan: "Qty" is what matters. Layers is usually derived from Qty / Ratio.
        # If we just output Qty, the frontend can calculate layers or we just say "Total allocations".
        
        rows_data = collections.defaultdict(dict) # color -> size -> qty
        
        has_content = False
        for d_idx, d in enumerate(demands):
            qty = solver.Value(allocation[(d_idx, g_idx)])
            if qty > 0:
                has_content = True
                rows_data[d['color']][d['size']] = rows_data[d['color']].get(d['size'], 0) + qty
                
        if not has_content:
            continue
            
        # Create Cut Plan Object
        # Flatten rows per color
        plan_rows = []
        for color, sizes_map in rows_data.items():
             plan_rows.append({
                 "colors": color,
                 "layers": 1, # Dummy, since we allocated Quants directly
                 "quantities": sizes_map
             })
             
        # List used rolls
        used_rolls_str = [str(r.topNo) for r in group['rolls']]
        
        summary_lines = []
        for r in plan_rows:
            q_str = ", ".join([f"{k}: {v}" for k,v in r['quantities'].items()])
            summary_lines.append(f"{r['colors']} -> {q_str}")
            
        plans.append({
            "id": plan_id,
            "group_name": group['name'],
            "shrinkage": group['name'], # Compat
            "lot": group['name'].split('/')[0], # Rough
            "mold": "Smart Group",
            "totalLayers": sum(sum(r['quantities'].values()) for r in plan_rows), # Total Units actually
            "markerRatio": {},
            "rows": plan_rows,
            "fabrics": f"Rolls: {', '.join(used_rolls_str)}",
            "cut_summary": summary_lines,
            "efficiency": 100.0,
            "used_rolls": used_rolls_str
        })
        plan_id += 1
        
    return plans

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
