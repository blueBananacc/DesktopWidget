# cdc-1200-touch.ps1 — open a CDC device path at 1200 baud to trigger ESP32-S3 download-mode reset
param([string]$Path)
$src = @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public class ComB {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern SafeFileHandle CreateFileW(string n, uint acc, uint share, IntPtr sa, uint cd, uint fl, IntPtr tm);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetCommState(SafeFileHandle h, IntPtr dcb);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetCommState(SafeFileHandle h, IntPtr dcb);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool EscapeCommFunction(SafeFileHandle h, uint f);
}
'@
Add-Type -TypeDefinition $src
$h = [ComB]::CreateFileW($Path, [uint32]3221225472, [uint32]0, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
if ($h.IsInvalid) { Write-Output "OPEN FAIL err=$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 1 }
$dcb = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(112)
[ComB]::GetCommState($h, $dcb) | Out-Null
[System.Runtime.InteropServices.Marshal]::WriteInt32($dcb, 4, 1200)
$ok = [ComB]::SetCommState($h, $dcb)
Write-Output "SetCommState(1200)=$ok err=$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
[ComB]::EscapeCommFunction($h, 5) | Out-Null   # SETDTR
[ComB]::EscapeCommFunction($h, 3) | Out-Null   # SETRTS
Start-Sleep -Milliseconds 400
$h.Close()
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($dcb)
Write-Output "done"
