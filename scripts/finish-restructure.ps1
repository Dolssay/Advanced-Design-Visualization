# Finishes the M1 restructure after the new frontend/ backend/ tools/ deploy/ docs/
# folders have been copied into the repo. It removes the old locations so git
# records the moves as renames (history follows with `git log --follow`).
#
# Run from the repository root in PowerShell:
#     .\scripts\finish-restructure.ps1
# If scripts are blocked:
#     powershell -ExecutionPolicy Bypass -File .\scripts\finish-restructure.ps1
#
# Nothing is committed; review with `git status` and commit yourself.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path "backend/app/main.py") -or -not (Test-Path "frontend/demo1/main.js")) {
    throw "New folders not found. Copy frontend/, backend/, tools/, deploy/, docs/ in first."
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "restructure/monorepo") {
    git switch -c restructure/monorepo
}

# Old tracked locations, now living under frontend/, backend/ and tools/.
$old = @(
    "src",
    "data/GTB777.csv",
    "data/Archer_Midnight.json",
    "package.json",
    "package-lock.json",
    "requirements.txt"
)
foreach ($path in $old) {
    if (git ls-files -- $path) { git rm -r -q -- $path }
}
# Leftovers git doesn't track (e.g. __pycache__) under src/
if (Test-Path "src") { Remove-Item -Recurse -Force "src" }

git add -A
git add -f "frontend/public/data/GTB777.csv"   # *.csv is ignored except this file

Write-Host ""
Write-Host "Staged. Renames detected:" -ForegroundColor Green
git status --short | Select-String "^R" | Measure-Object | ForEach-Object { Write-Host "  $($_.Count) files moved" }
Write-Host ""
Write-Host "Next:"
Write-Host "  git status"
Write-Host '  git commit -m "Split repo into frontend/ and backend/; add FastAPI + Vite (M1-M4)"'
Write-Host ""
Write-Host "The root node_modules/ (from the old package.json) is no longer used; delete it when convenient."
