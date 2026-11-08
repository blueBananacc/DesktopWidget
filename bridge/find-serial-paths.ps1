# find-serial-paths.ps1 — list device paths for the serial device-interface GUID (optionally filtered)
param([string]$Match = '303a|1a86')
$src = @'
using System;
using System.Runtime.InteropServices;
public class SetupApi {
  [DllImport("setupapi.dll",SetLastError=true)] public static extern IntPtr SetupDiGetClassDevsW(ref Guid g, string e, IntPtr h, uint f);
  [DllImport("setupapi.dll",SetLastError=true)] public static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, uint i, ref SP_DEVINT_DATA t);
  [DllImport("setupapi.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr s, ref SP_DEVINT_DATA t, IntPtr dd, uint dl, out uint rq, IntPtr di);
  [DllImport("setupapi.dll")] public static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [StructLayout(LayoutKind.Sequential)] public struct SP_DEVINT_DATA { public uint cbSize; public Guid ClassGuid; public uint Flags; public IntPtr Reserved; }
}
'@
Add-Type -TypeDefinition $src
$guid=[guid]'86e0d1e0-8089-11d0-9ce4-08003e301f73'
$set=[SetupApi]::SetupDiGetClassDevsW([ref]$guid,$null,[IntPtr]::Zero,0x12)
$d=New-Object SetupApi+SP_DEVINT_DATA; $d.cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($d)
for($i=0;[SetupApi]::SetupDiEnumDeviceInterfaces($set,[IntPtr]::Zero,[ref]$guid,$i,[ref]$d);$i++){
  $rq=0
  [SetupApi]::SetupDiGetDeviceInterfaceDetailW($set,[ref]$d,[IntPtr]::Zero,0,[ref]$rq,[IntPtr]::Zero)|Out-Null
  $buf=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($rq)
  [System.Runtime.InteropServices.Marshal]::WriteInt32($buf,8)
  if([SetupApi]::SetupDiGetDeviceInterfaceDetailW($set,[ref]$d,$buf,$rq,[ref]$rq,[IntPtr]::Zero)){
    $p=[System.Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]($buf.ToInt64()+4))
    if(-not $Match -or $p -match $Match){ Write-Output $p }
  }
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
}
[SetupApi]::SetupDiDestroyDeviceInfoList($set)|Out-Null
