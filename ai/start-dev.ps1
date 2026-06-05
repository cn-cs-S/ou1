Set-Location -LiteralPath $PSScriptRoot
$logPath = Join-Path $PSScriptRoot "next-dev.log"
"[$(Get-Date -Format o)] starting next dev" | Out-File -FilePath $logPath -Encoding utf8
& "C:\Program Files\nodejs\npm.cmd" run dev -- -p 3000 *>> $logPath
"[$(Get-Date -Format o)] next dev exited with $LASTEXITCODE" | Out-File -FilePath $logPath -Encoding utf8 -Append
