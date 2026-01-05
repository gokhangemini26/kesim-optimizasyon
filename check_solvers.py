from ortools.linear_solver import pywraplp

def check_solvers():
    solvers = ["CLP", "CBC", "GLOP", "BOP", "SAT", "SCIP"]
    for s in solvers:
        solver = pywraplp.Solver.CreateSolver(s)
        print(f"Solver {s}: {'Available' if solver else 'Not Available'}")

if __name__ == "__main__":
    check_solvers()
