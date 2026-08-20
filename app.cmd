@echo off
rem Lanza la app de escritorio sin pasar por npm/npx: en PowerShell chocan con
rem la politica de ejecucion de scripts (npm.ps1 / npx.ps1 bloqueados).
rem
rem   .\app.cmd                  abre la ventana y reproduce la URL de prueba
rem   .\app.cmd --auto-exit 15   se cierra solo a los 15 segundos
"%~dp0node_modules\.bin\electron.cmd" "%~dp0apps\desktop" %*
