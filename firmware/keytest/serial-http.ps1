# HTTP 隧道冒烟测试：直接在 USB 串口上发 HTTP/1.1 报文（doc/http-api/tunnel.md），打印设备响应帧
# 用法：powershell -File serial-http.ps1 -Port COM20
param([string]$Port = "COM20")
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
  $head = "$method $path HTTP/1.1`r`nX-Request-Id: t$($script:n)`r`n"
  if ($json) { $head += "Content-Type: application/json`r`n" }
  $head += "Content-Length: $($body.Length)`r`n`r`n"
  $h = [System.Text.Encoding]::ASCII.GetBytes($head)
  $p.Write($h, 0, $h.Length)
  if ($body.Length) { $p.Write($body, 0, $body.Length) }
  Start-Sleep -Milliseconds 450
  $out = $p.ReadExisting()
  "=== $method $path $json"
  # 只打印 HTTP 帧（起始行 + 关键头 + 报文体），跳过设备日志行
  $lines = $out -split "`n" | ForEach-Object { $_.TrimEnd("`r") }
  $inFrame = $false
  foreach ($l in $lines) {
    if ($l -match '^HTTP/1\.1 ') { $inFrame = $true; $l; continue }
    if ($inFrame -and $l -match '^(X-Request-Id|Content-Type):') { "  $l"; continue }
    if ($inFrame -and $l -eq '') { continue }
    if ($inFrame -and $l -notmatch '^(Content-Length:|\[)') { "  $l"; $inFrame = $false }
  }
}

Req GET  /api/version
Req GET  /api/keys
Req PUT  /api/keys '{"k1":"work","k2":"busy","k3":"rest","k4":"meet"}'
Req PUT  /api/keys '{"k1":"offwork","k2":"busy","k3":"cycleL","k4":"cycleR","t":"rest"}'
Req GET  /api/nope
Req DELETE /api/version
Req PATCH /api/led '{"br":"x"}'
Req PATCH /api/led '{"br":40}'
Req GET  /api/share
Req GET  /api/state
Req GET  /api/time
Req POST /api/schedules/zzz/activate
Req GET  /api/events
$p.Close()
