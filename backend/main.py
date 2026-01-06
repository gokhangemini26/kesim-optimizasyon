from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Union
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
    fabrics: List[FabricRaw]
    avgConsumption: float

class CutPlanRow(BaseModel):
    colors: str
    layers: int
    quantities: Dict[str, int]

class CutPlan(BaseModel):
    id: int
    group_name: str
    shrinkage: str = ""
    lot: str = ""
    mold: str = "Smart Group"
    used_rolls: List[str]
    fabrics: str = ""
    cut_summary: List[str]
    totalLayers: int
    efficiency: float
    markerRatio: Dict[str, int] = {}
    rows: List[CutPlanRow]

# --- Parsing Helper ---
def parse_shrinkage(code: str):
    code = code.upper().replace(" ", "")
    en_match = re.search(r'E(\d+\.?\d*)', code)
    boy_match = re.search(r'B(\d+\.?\d*)', code)
    en_val = float(en_match.group(1)) if en_match else 0.0
    boy_val = float(boy_match.group(1)) if boy_match else 0.0
    # Return single float for sorting? User logic sorts by "shrinkage".
    # Let's return a tuple or sum for strict ordering?
    # User says: "sorted by shrinkage". E55 B45 vs E50 B50?
    return en_val + boy_val # Simple sum for now? Or tuple.

# --- USER ALGORITHM IMPLEMENTATION ---

class FabricLot:
    def __init__(self, lot_id, shrinkage, shrinkage_code, rolls):
        self.lot_id = lot_id
        self.shrinkage = shrinkage # float sort key
        self.shrinkage_code = shrinkage_code
        self.rolls = rolls # List[FabricRaw]
        self.total_metraj = sum(r.metraj for r in rolls)
        self.used_metraj = 0.0

    @property
    def remaining_metraj(self):
        return self.total_metraj - self.used_metraj

def generate_size_groups(sizes):
    """
    Max 4 sizes.
    - Same size repeats
    - Small + Large matches
    """
    groups = []
    
    # 1. Single size repeats (2 to 4)
    for s in sizes:
        for count in range(2, 5):
             groups.append([s] * count)

    # 2. Small + Large matches
    # We need to determine "Small" and "Large" from the Current Available Sizes
    # Dynamic classification?
    # Sort sizes based on numerical value
    sorted_sizes = sorted(sizes, key=lambda x: str(x)) # e.g. 28/32 sort as string or number? usually string works for fixed length, else custom
    # Let's assume standard textile sizes, numeric sort is safer if convertable
    def size_val(s):
        try:
             # Handle 28/32 -> 28. 2XS -> ?
            parts = str(s).split('/')
            return int(parts[0]) if parts[0].isdigit() else 0
        except:
             return 0
             
    sorted_sizes = sorted(sizes, key=size_val)
    
    if len(sorted_sizes) >= 2:
        small = sorted_sizes[:2]
        large = sorted_sizes[-2:]
        
        # Combinations
        for s in small:
            for l in large:
                groups.append([s, s, l, l]) # 2 small 2 large
                groups.append([s, l])       # 1 small 1 large
                groups.append([s, s, l])    # 2 small 1 large
                groups.append([s, l, l])    # 1 small 2 large

    return groups

def valid_pastal(size_group):
    # Rule: Max 4 sizes
    if len(size_group) > 4: return False
    
    unique = list(set(size_group))
    if len(unique) == 1: return True # All same OK
    
    # Check Small/Large balance
    def size_val(s):
        try:
            parts = str(s).split('/')
            return int(parts[0]) if parts[0].isdigit() else 0
        except: return 0

    vals = sorted([size_val(s) for s in unique])
    # Heuristic: If we have mixed sizes, range should be wide?
    # User rule: "En kucuk 2 + En buyuk 2"
    # This check is hard to enforce strictly on a generic group without global context.
    # But generate_size_groups ALREADY generated only valid candidates (Small+Large).
    # So we mainly trust generation.
    return True

def calculate_layers_and_consumption(size_group, size_demand, lot, avg_consumption):
    """
    Returns (layers, used_meters, valid)
    """
    MAX_LAYERS = 80
    
    # Marker Length Calculation (Est)
    marker_len = avg_consumption * len(size_group)
    
    # 1. Max layers allowed by LOT METRAJ
    if marker_len <= 0: return 0, 0, False
    
    max_from_lot = math.floor(lot.remaining_metraj / marker_len)
    
    # 2. Max layers allowed by DEMAND
    max_from_demand = MAX_LAYERS
    counts = collections.Counter(size_group)
    
    for s, count in counts.items():
        if size_demand[s] <= 0: return 0, 0, False
        allowed = size_demand[s] // count
        max_from_demand = min(max_from_demand, allowed)
        
    final_layers = min(max_from_lot, max_from_demand)
    
    if final_layers <= 0: return 0, 0, False
    
    return final_layers, final_layers * marker_len, True

@app.post("/optimize", response_model=List[CutPlan])
def optimize_cutting_custom(data: OptimizationRequest):
    print(f"Starting Custom Optimization: {len(data.orderRows)} orders")
    
    # 1. Group Orders by Color
    # logic: Plan per color sequentially
    demands_by_color = collections.defaultdict(lambda: collections.defaultdict(int))
    for order in data.orderRows:
        for size, qty in order.quantities.items():
            if qty > 0:
                demands_by_color[order.color][size] += qty
                
    # 2. Prepare Fabric Lots
    # Group by Lot Number + Shrinkage Code
    # Assuming fabrics with same Lot + Shrinkage are one "FabricLot" resource
    grouped_fabrics = collections.defaultdict(list)
    for f in data.fabrics:
        key = (f.lot, f.shrinkageCode)
        grouped_fabrics[key].append(f)
        
    fabric_lots_objects = []
    for (lot_id, shrink_code), rolls in grouped_fabrics.items():
        sort_val = parse_shrinkage(shrink_code)
        fabric_lots_objects.append(FabricLot(lot_id, sort_val, shrink_code, rolls))
        
    # Sort Lots by Shrinkage (User Rule 3)
    fabric_lots_objects.sort(key=lambda x: x.shrinkage)
    
    plans = []
    cut_id_counter = 1
    
    avg_cons = data.avgConsumption
    
    # Iterate Colors (Requirement: One Color -> One Lot ideally)
    # We process colors one by one? 
    # Or do we process Lots and fill them with whatever color?
    # User Rule: "Bir renk ayni lottan kesilir... mumkunse karismaz"
    # Strategy: For each color, pick best matching Lot(s).
    # OR: Iterate Lots, and assign best fitting Color?
    # User's pseudo code iterates Lots: "for lot in fabric_lots..."
    # And "available_sizes = [s for s in size_demand...]"
    # This implies the User's Logic mixes Colors in the loop? 
    # NO, usually cutting plan is mono-color.
    # We should run the user's "Greedy Strategy" PER COLOR.
    
    sorted_colors = sorted(demands_by_color.keys())
    
    for color in sorted_colors:
        size_demand = demands_by_color[color] # Mutable dict
        
        # Filter Lots that match this color? 
        # In this system, Fabric is generic (Raw Material). Color is dyed? 
        # Or is Fabric ALREADY Colored?
        # Usually Fabric Table has Lot/Shrinkage. Does it have Color?
        # The Current `FabricRaw` model does NOT have Color.
        # Implication: All fabrics are same base or Color is irrelevant (Denim washing?).
        # Or we assume all uploaded fabric is for the currently processed Order.
        # We proceed assuming All Lots are eligible for All Colors (or User manages this).
        
        # We need to iterate Lots for this Color
        # Note: If we use a Lot for Color A, we reduce its metraj.
        
        for lot in fabric_lots_objects:
            if lot.remaining_metraj < 1: continue
            
            # While Demand Exists and Lot has space
            while True:
                available_sizes = [s for s, q in size_demand.items() if q > 0]
                if not available_sizes: break
                if lot.remaining_metraj < avg_cons: break # too small
                
                size_groups = generate_size_groups(available_sizes)
                
                best_plan_data = None
                best_qty = -1
                
                for group in size_groups:
                    # Validate
                    if not valid_pastal(group): continue
                    
                    layers, used_m, valid = calculate_layers_and_consumption(group, size_demand, lot, avg_cons)
                    
                    if not valid: continue
                    
                    qty = layers * len(group)
                    
                    # Greedy Metric: Maximize Qty
                    if qty > best_qty:
                        best_qty = qty
                        best_plan_data = (group, layers, used_m)

                if not best_plan_data:
                    break # No valid move for this Lot + Demand
                    
                # Execute Best Move
                group, layers, used_m = best_plan_data
                
                # Deduct Demand
                for s in group:
                    size_demand[s] -= layers
                    
                # Deduct Lot
                lot.used_metraj += used_m
                
                # Record Plan
                sizes_map = collections.Counter(group)
                
                plans.append({
                    "id": cut_id_counter,
                    "group_name": f"{color} - {lot.lot_id}",
                    "shrinkage": lot.shrinkage_code,
                    "lot": lot.lot_id,
                    "mold": "Custom Algo",
                    "used_rolls": [str(r.topNo) for r in lot.rolls], # Simplified
                    "fabrics": f"Lot {lot.lot_id} ({used_m:.1f}m)",
                    "cut_summary": [],
                    "totalLayers": layers, # Note: Frontend shows "Adet" sometimes? User said "Kat: 35".
                    "efficiency": 100.0,
                    "markerRatio": dict(sizes_map), # { "32": 2, "34": 1 }
                    "rows": [{
                        "colors": color,
                        "layers": layers,
                        "quantities": {s: int(c * layers) for s,c in sizes_map.items()}
                    }]
                })
                cut_id_counter += 1
                
                if lot.remaining_metraj < 1: break
    
    return plans

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
