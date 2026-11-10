@echo off
rem Sync and release everything that is waiting: npm run ship -- --all (RELEASING.md, "Sync and release everything that is waiting").
rem Runs from any folder, so a copy on the desktop works with a double click. All the logic is in scripts/ship.js.
rem The repository is %USERPROFILE%\Projects\vault-graph unless VAULT_GRAPH_REPO names another folder.
setlocal
if "%VAULT_GRAPH_REPO%"=="" set "VAULT_GRAPH_REPO=%USERPROFILE%\Projects\vault-graph"
if not exist "%VAULT_GRAPH_REPO%\scripts\ship.js" (
  echo FAIL - no Vault Graph repository at "%VAULT_GRAPH_REPO%".
  echo Clone it there, or set VAULT_GRAPH_REPO to its folder, then run this again.
  goto end
)
where node >nul 2>nul || (echo FAIL - Node.js is not installed or not on the path. Install it from nodejs.org, then run this again. & goto end)
where gh >nul 2>nul || (echo FAIL - the GitHub CLI ^(gh^) is not installed or not on the path. Install it, run gh auth login, then run this again. & goto end)
cd /d "%VAULT_GRAPH_REPO%"
node scripts\ship.js --all
:end
echo.
pause
endlocal
