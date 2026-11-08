# HTTP 隧道冒烟测试 #2：覆盖冒烟 1 未测的路由（todos/schedules/timer/agent/apps/stt/reminders/events DELETE）
param([string]$Port = "COM8")
$p = New-Object System.IO.Ports.SerialPort $Port, 460800
$p.DtrEnable = $false; $p.RtsEnable = $false
$p.Encoding = [System.Text.Encoding]::UTF8
$p.Open()
Start-Sleep -Milliseconds 400
$null = $p.ReadExisting()
$script:n = 0

function Req([string]$method, [string]$path, [string]$json = "") {
  $script:n++
  $body = [System.Text.Encoding]::UTF8.GetBytes($json)
  $head = "$method $path HTTP/1.1`r`nX-Request-Id: t$($script:n)`r`nX-Api-Sem-Ver: 1.0.0`r`n"
  if ($json) { $head += "Content-Type: application/json`r`n" }
  $head += "Content-Length: $($body.Length)`r`n`r`n"
  $h = [System.Text.Encoding]::ASCII.GetBytes($head)
  $p.Write($h, 0, $h.Length)
  if ($body.Length) { $p.Write($body, 0, $body.Length) }
  Start-Sleep -Milliseconds 450
  $out = $p.ReadExisting()
  "=== $method $path $json"
  $lines = $out -split "`n" | ForEach-Object { $_.TrimEnd("`r") }
  $inFrame = $false
  foreach ($l in $lines) {
    if ($l -match '^HTTP/1\.1 ') { $inFrame = $true; $l; continue }
    if ($inFrame -and $l -match '^(X-Request-Id|Content-Type):') { "  $l"; continue }
    if ($inFrame -and $l -eq '') { continue }
    if ($inFrame -and $l -notmatch '^(Content-Length:|\[)') { "  $l"; $inFrame = $false }
  }
}

Req PUT /api/state                       # 400 status required
Req GET /api/apps
Req GET /api/apps/work                   # 404 无该状态程序
Req POST /api/todos '{"text":"冒烟测试待办","show":false}'   # 200 {result,id}
Req GET /api/todos
Req DELETE /api/todos/t1
Req POST /api/todos/zzz                  # 405 (path exists, POST not allowed)
Req PATCH /api/todos/zzz '{"done":true}' # 404
Req POST /api/reminders '{"text":"test","n":1}'            # 200
Req POST /api/timer/start '{"minutes":30}'                 # 200 + timer 事件
Req GET /api/timer
Req POST /api/timer/cancel               # 200
Req POST /api/agent/response '{"message":{"role":"assistant","content":"x"}}'  # 409 not_waiting
Req POST /api/agent/cancel               # 200
Req POST /api/stt/stop                   # 200
Req POST /api/schedules '{"name":"t","kind":"date","date":"2099-01-01","ns":[{"t":"08:00","st":"work"}]}'  # 200 {result,id}
Req GET /api/schedules
Req DELETE /api/events                   # 200 关订阅（本就没订过）
$p.Close()
