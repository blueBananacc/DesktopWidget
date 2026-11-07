param([int]$Phase = 1)
$pa = New-Object System.IO.Ports.SerialPort "COM8", 460800
$pb = New-Object System.IO.Ports.SerialPort "COM20", 460800
foreach ($p in @($pa, $pb)) { $p.DtrEnable = $false; $p.RtsEnable = $false; $p.Open() }
Start-Sleep -Milliseconds 500
$null = $pa.ReadExisting(); $null = $pb.ReadExisting()

if ($Phase -eq 1) {
  # 配置：不同昵称、同区域码、开分享
  $pa.WriteLine('{"type":"share","op":"set","en":true,"name":"小张-A","zone":"office"}')
  Start-Sleep -Milliseconds 400
  "=== A(COM8) share ack"
  ($pa.ReadExisting() -split "`n" | Where-Object { $_ -match '"share"|SHARE' } | ForEach-Object { $_.Trim() })
  $pb.WriteLine('{"type":"share","op":"set","en":true,"name":"小王-B","zone":"office"}')
  Start-Sleep -Milliseconds 400
  "=== B(COM20) share ack"
  ($pb.ReadExisting() -split "`n" | Where-Object { $_ -match '"share"|SHARE' } | ForEach-Object { $_.Trim() })
  "=== 等待 25s 让双方互相收 ESP-NOW 广播"
  $t0 = Get-Date
  $seenA = ""; $seenB = ""
  while (((Get-Date) - $t0).TotalSeconds -lt 25) {
    Start-Sleep -Milliseconds 500
    $seenA += $pa.ReadExisting(); $seenB += $pb.ReadExisting()
  }
  "=== A(COM8) peers/ESPNOW lines"
  ($seenA -split "`n" | Where-Object { $_ -match '"peers"|PEER|peer' } | ForEach-Object { $_.Trim() })
  "=== B(COM20) peers/ESPNOW lines"
  ($seenB -split "`n" | Where-Object { $_ -match '"peers"|PEER|peer' } | ForEach-Object { $_.Trim() })
} elseif ($Phase -eq 2) {
  # 切 A 的状态到 focus，看 B 的 peers 是否跟着变
  $pa.WriteLine('{"type":"state","status":"focus"}')
  Start-Sleep -Seconds 6
  "=== B(COM20) after A->focus"
  ($pb.ReadExisting() -split "`n" | Where-Object { $_ -match '"peers"|peer' } | ForEach-Object { $_.Trim() })
} else {
  # 关 B 的分享，A 应该不再收到 B 的心跳 → 过期剔除
  $pb.WriteLine('{"type":"share","op":"set","en":false}')
  Start-Sleep -Milliseconds 400
  "=== B share off ack"
  ($pb.ReadExisting() -split "`n" | Where-Object { $_ -match '"share"' } | ForEach-Object { $_.Trim() })
  "=== 等待 70s 看 A 侧 B 是否过期剔除"
  $t0 = Get-Date; $buf = ""
  while (((Get-Date) - $t0).TotalSeconds -lt 70) {
    Start-Sleep -Milliseconds 800; $buf += $pa.ReadExisting()
  }
  ($buf -split "`n" | Where-Object { $_ -match '"peers"|peer' } | ForEach-Object { $_.Trim() })
}
$pa.Close(); $pb.Close()
