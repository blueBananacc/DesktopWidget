# dump-usbdesc.ps1 — read raw USB descriptors via hub ioctls
# usage: powershell -File dump-usbdesc.ps1 [-Vid 0x303A] [-Pid 0x1002]
param([int]$Vid = 0x303A, [int]$ProductId = 0x1002, [switch]$All, [int]$WatchSec = 0)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class USB {
  [DllImport("setupapi.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr SetupDiGetClassDevsW(ref Guid ClassGuid, string Enumerator, IntPtr hwndParent, uint Flags);
  [DllImport("setupapi.dll", SetLastError=true)]
  public static extern bool SetupDiEnumDeviceInterfaces(IntPtr devs, IntPtr devInfo, ref Guid ClassGuid, uint idx, ref SP_DEVICE_INTERFACE_DATA data);
  [DllImport("setupapi.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr devs, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, uint size, out uint req, IntPtr devInfo);
  [DllImport("setupapi.dll")] public static extern bool SetupDiDestroyDeviceInfoList(IntPtr devs);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inBuf, uint inLen, byte[] outBuf, uint outLen, out uint ret, IntPtr ov);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

  [StructLayout(LayoutKind.Sequential)]
  public struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid ClassGuid; public int Flags; public IntPtr Reserved; }

  public const uint IOCTL_GET_NODE_INFO   = 0x220408;
  public const uint IOCTL_GET_CONN_INFO_EX= 0x220448;
  public const uint IOCTL_GET_DESCRIPTOR  = 0x220410;
  public const uint GEN_RW = 0xC0000000, SHARE_ALL = 3, OPEN_EXISTING = 3;
  public static readonly Guid GUID_USB_HUB = new Guid("f18a0e88-c30c-11d0-8815-00a0c906bed8");
}
'@

function Get-HubPaths {
  $paths = @()
  $g = [USB]::GUID_USB_HUB
  $devs = [USB]::SetupDiGetClassDevsW([ref]$g, $null, [IntPtr]::Zero, 0x12)  # PRESENT|DEVICEINTERFACE
  if ($devs -eq [IntPtr]::MinusOne) { throw "SetupDiGetClassDevs failed $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $d = New-Object USB+SP_DEVICE_INTERFACE_DATA; $d.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($d)
  for ($i = 0; [USB]::SetupDiEnumDeviceInterfaces($devs, [IntPtr]::Zero, [ref]$g, $i, [ref]$d); $i++) {
    $req = 0
    [USB]::SetupDiGetDeviceInterfaceDetailW($devs, [ref]$d, [IntPtr]::Zero, 0, [ref]$req, [IntPtr]::Zero) | Out-Null
    $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal($req)
    [Runtime.InteropServices.Marshal]::WriteInt32($buf, 8)  # cbSize
    $ok = [USB]::SetupDiGetDeviceInterfaceDetailW($devs, [ref]$d, $buf, $req, [ref]$req, [IntPtr]::Zero)
    if ($ok) { $paths += [Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]($buf.ToInt64() + 4)) }
    [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
  }
  [USB]::SetupDiDestroyDeviceInfoList($devs) | Out-Null
  return $paths
}

function Set-U16($io, [int]$off, [uint16]$v) { $b = [BitConverter]::GetBytes($v); $io[$off] = $b[0]; $io[$off+1] = $b[1] }
function Set-U32($io, [int]$off, [uint32]$v) { $b = [BitConverter]::GetBytes($v); for ($i=0;$i -lt 4;$i++){ $io[$off+$i] = $b[$i] } }

function Get-Desc($h, [uint32]$port, [byte]$dtype, [byte]$didx, [uint16]$langid, [uint16]$len) {
  $io = New-Object byte[] (12 + 4096)
  Set-U32 $io 0 $port
  $io[4] = 0x80; $io[5] = 6
  Set-U16 $io 6 ((($dtype -shl 8) -bor $didx))
  Set-U16 $io 8 $langid
  Set-U16 $io 10 $len
  $ret = 0
  $out = New-Object byte[] (12 + 4096)
  $ok = [USB]::DeviceIoControl($h, [USB]::IOCTL_GET_DESCRIPTOR, $io, $io.Length, $out, $out.Length, [ref]$ret, [IntPtr]::Zero)
  if (-not $ok) { Write-Host "  getdesc type=$dtype idx=$didx err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; return $null }
  return $out[12..(12 + $ret - 1)]
}

function Hex($b, [int]$off, [int]$len) { ($b[$off..($off+$len-1)] | ForEach-Object { '{0:X2}' -f $_ }) -join ' ' }

$deadline = if ($WatchSec -gt 0) { (Get-Date).AddSeconds($WatchSec) } else { $null }
$found = $false
do {
foreach ($p in Get-HubPaths) {
  $h = [USB]::CreateFileW($p, [USB]::GEN_RW, [USB]::SHARE_ALL, [IntPtr]::Zero, [USB]::OPEN_EXISTING, 0, [IntPtr]::Zero)
  if ($h -eq [IntPtr]::MinusOne) { Write-Host "  open fail $($p.Split('#')[1]) err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; continue }
  # node info → port count
  $out = New-Object byte[] 256; $ret = 0
  if (-not [USB]::DeviceIoControl($h, [USB]::IOCTL_GET_NODE_INFO, $null, 0, $out, 256, [ref]$ret, [IntPtr]::Zero)) { Write-Host "  nodeinfo fail $($p.Split('#')[1]) err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; [USB]::CloseHandle($h) | Out-Null; continue }
  $ports = $out[6]
  $hubId = ($p -split '#')[2]
  Write-Host "hub $hubId ports=$ports"
  for ($port = 1; $port -le $ports; $port++) {
    $io = New-Object byte[] 1024
    Set-U32 $io 0 ([uint32]$port)
    Set-U32 $io 4 1024  # EX_V2 input: Length of caller buffer
    Set-U32 $io 8 0x0F  # SupportedUsbProtocols: all speeds
    Set-U32 $io 12 0    # Flags
    $resp = New-Object byte[] 1024; $ret = 0
    $ok = [USB]::DeviceIoControl($h, [USB]::IOCTL_GET_CONN_INFO_EX, $io, 1024, $resp, 1024, [ref]$ret, [IntPtr]::Zero)
    if (-not $ok) { Write-Host "  port $port conninfo err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; continue }
    $descVid = [BitConverter]::ToUInt16($resp, 4 + 8)
    $descPid = [BitConverter]::ToUInt16($resp, 4 + 10)
    if ($All) {
      $stat = [BitConverter]::ToUInt32($resp, 4 + 28)
      $raw = (Hex $resp 0 48)
      Write-Host ("  {0} port {1,2}: VID={2:X4} PID={3:X4} status={4} ret={5}`n     {6}" -f $hubId, $port, $descVid, $descPid, $stat, $ret, $raw)
      continue
    }
    if ($descVid -ne $Vid -or $descPid -ne $ProductId) { continue }
    $found = $true
    Write-Host "=== HIT $($p.Split('#')[1..2] -join '#')  port $port ==="
    Write-Host "devdesc: $(Hex $resp 4 18)"
    $bcd = [BitConverter]::ToUInt16($resp, 4 + 2)
    Write-Host ("bcdUSB={0:X4}  VID={1:X4} PID={2:X4}  class={3:X2}/{4:X2}/{5:X2}" -f $bcd, $descVid, $descPid, $resp[8], $resp[9], $resp[10])

    $cfg = Get-Desc $h $port 0x02 0 0 9
    if ($cfg) {
      $total = [BitConverter]::ToUInt16($cfg, 2)
      $nItf  = $cfg[4]
      Write-Host "`ncfg hdr($($cfg.Length)B): $(Hex $cfg 0 $cfg.Length)   wTotal=$total bNumItf=$nItf"
      $full = Get-Desc $h $port 0x02 0 0 $total
      if ($full) {
        Write-Host "cfg full($($full.Length)B):"
        for ($i = 0; $i -lt $full.Length; $i += 16) {
          $n = [Math]::Min(16, $full.Length - $i)
          Write-Host ("  {0:X4}: {1}" -f $i, (Hex $full $i $n))
        }
      }
    }
    # BOS
    $bos = Get-Desc $h $port 0x0F 0 0 255
    if ($bos) {
      Write-Host "`nBOS($($bos.Length)B):" -NoNewline; Write-Host ''
      for ($i = 0; $i -lt $bos.Length; $i += 16) {
        $n = [Math]::Min(16, $bos.Length - $i)
        Write-Host ("  {0:X4}: {1}" -f $i, (Hex $bos $i $n))
      }
    } else { Write-Host "`nBOS: <fetch failed>" }
    Write-Host "`nstrings:"
    for ($s = 0; $s -le 9; $s++) {
      $str = Get-Desc $h $port 0x03 $s 0x0409 255
      if ($str -and $str.Length -ge 2) {
        if ($s -eq 0) { $txt = ($str[2..($str.Length-1)] | ForEach-Object { '{0:X2}' -f $_ }) -join '' }
        else { $txt = [Text.Encoding]::Unicode.GetString($str[2..($str.Length-1)]) }
        Write-Host "  [$s] $txt"
      }
    }
    Write-Host ""
  }
  [USB]::CloseHandle($h) | Out-Null
}
  if ($found -or -not $deadline) { break }
  Start-Sleep -Milliseconds 400
} while ((Get-Date) -lt $deadline)
if (-not $found) { Write-Host "device VID=$('{0:X4}' -f $Vid) PID=$('{0:X4}' -f $ProductId) not found" }
