@echo off
cd /d %~dp0..
set SMOKE_SECONDS=300
call npm run smoke > research\smoke-run-2026-09-09-run3.log 2>&1
