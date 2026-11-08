# read-serial-path.ps1 — open a serial device interface path, pulse RTS to reset, read output
param([string]$Path, [int]$Sec = 12, [int]$Baud = 115200, [switch]$Reset, [switch]$CdcConnect, [string]$Send)

$src = @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public class ComRaw {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern SafeFileHandle CreateFileW(string n, uint acc, uint share, IntPtr sa, uint cd, uint fl, IntPtr tm);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetCommState(SafeFileHandle h, IntPtr dcb);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetCommState(SafeFileHandle h, IntPtr dcb);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool EscapeCommFunction(SafeFileHandle h, uint f);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadFile(SafeFileHandle h, byte[] b, uint n, out uint r, IntPtr o);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool WriteFile(SafeFileHandle h, byte[] b, uint n, out uint w, IntPtr o);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetCommTimeouts(SafeFileHandle h, IntPtr t);
  public const uint SETRTS=3, CLRRTS=4, SETDTR=5, CLRDTR=6;
}
'@
Add-Type -TypeDefinition $src

$h = [ComRaw]::CreateFileW($Path, [uint32]3221225472, [uint32]0, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
if ($h.IsInvalid) { Write-Output "OPEN FAILED err=$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 1 }

# DCB: 112 bytes, baud@4, flags@8 (fBinary|fDtrControl|fRtsControl), bytesize@18...
$dcb = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(112)
[ComRaw]::GetCommState($h, $dcb) | Out-Null
[System.Runtime.InteropServices.Marshal]::WriteInt32($dcb, 4, $Baud)
$flags = [System.Runtime.InteropServices.Marshal]::ReadInt32($dcb, 8)
[System.Runtime.InteropServices.Marshal]::WriteInt32($dcb, 8, ($flags -bor 0x0001))  # fBinary
[System.Runtime.InteropServices.Marshal]::WriteByte($dcb, 18, 8)                    # ByteSize=8
[ComRaw]::SetCommState($h, $dcb) | Out-Null
# timeouts: read interval MAX, total const 300ms
$tmo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(20)
[System.Runtime.InteropServices.Marshal]::WriteInt32($tmo, 0, -1)
[ComRaw]::SetCommTimeouts($h, $tmo) | Out-Null

if ($Reset) {
  [ComRaw]::EscapeCommFunction($h, [ComRaw]::CLRDTR) | Out-Null   # BOOT deasserted
  [ComRaw]::EscapeCommFunction($h, [ComRaw]::SETRTS) | Out-Null   # EN low → reset
  Start-Sleep -Milliseconds 80
  [ComRaw]::EscapeCommFunction($h, [ComRaw]::CLRRTS) | Out-Null   # EN high → run
} else {
  # CDC 设备：断言 DTR+RTS 让固件认为主机已连上（tud_cdc_n_connected 门控 write）
  [ComRaw]::EscapeCommFunction($h, [ComRaw]::SETDTR) | Out-Null
  [ComRaw]::EscapeCommFunction($h, [ComRaw]::SETRTS) | Out-Null
}

if ($Send) {
  $b = [Text.Encoding]::ASCII.GetBytes($Send)
  $w = [uint32]0
  [ComRaw]::WriteFile($h, $b, [uint32]$b.Length, [ref]$w, [IntPtr]::Zero) | Out-Null
}

$buf = New-Object byte[] 8192
$end = (Get-Date).AddSeconds($Sec)
while ((Get-Date) -lt $end) {
  $r = [uint32]0
  [ComRaw]::ReadFile($h, $buf, [uint32]8192, [ref]$r, [IntPtr]::Zero) | Out-Null
  if ($r -gt 0) { Write-Host -NoNewline ([Text.Encoding]::ASCII.GetString($buf, 0, [int]$r)) }
}
$h.Close()
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($dcb)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($tmo)
Write-Output "`n[EOF]"
