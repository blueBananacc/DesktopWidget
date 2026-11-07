param([int]$Phase = 1)
$p = New-Object System.IO.Ports.SerialPort "COM8", 460800
$p.DtrEnable = $false; $p.RtsEnable = $false
$p.Open()
Start-Sleep -Milliseconds 400
$null = $p.ReadExisting()
function Send($s) { $p.WriteLine($s); Start-Sleep -Milliseconds 300 }
function Dump($label, $pat = '"type"\s*:\s*"keys"|KEYS') {
  Start-Sleep -Milliseconds 700
  $o = $p.ReadExisting()
  "=== $label"
  ($o -split "`n" | Where-Object { $_ -match $pat } | ForEach-Object { $_.Trim() })
}

if ($Phase -eq 1) {
  Send '{"type":"keys","k1":"work","k2":"offwork","k3":"rest","k4":"meet","t":"focus25"}'
  Dump "legal map (k2=offwork, t=focus25)"
  Send '{"type":"keys","k1":"work","k2":"busy","k3":"rest","k4":"meet"}'
  Dump "illegal map (no offwork) -> expect rejected"
} else {
  Send '{"type":"sync"}'
  Dump "after reset: persisted snapshot"
}
$p.Close()
