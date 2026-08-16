param(
  [Parameter(Mandatory = $true)][string]$Bl,
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$OutBin,
  [Parameter(Mandatory = $true)][string]$OutHex,
  [Parameter(Mandatory = $true)][string]$ObjCopy
)

if (-not (Test-Path $Bl)) {
  Write-Host "skip factory image (build 03 Firmware/bootloader Release first)"
  exit 0
}
if (-not (Test-Path $App)) { throw "missing app $App" }

$bootSize = 4096
$blBytes = [IO.File]::ReadAllBytes($Bl)
$appBytes = [IO.File]::ReadAllBytes($App)
if ($blBytes.Length -gt $bootSize) {
  throw "bootloader is $($blBytes.Length) bytes (max $bootSize)"
}
$out = New-Object byte[] ($bootSize + $appBytes.Length)
for ($i = 0; $i -lt $bootSize; $i++) { $out[$i] = 0xFF }
[Array]::Copy($blBytes, 0, $out, 0, $blBytes.Length)
[Array]::Copy($appBytes, 0, $out, $bootSize, $appBytes.Length)
[IO.File]::WriteAllBytes($OutBin, $out)
& $ObjCopy -I binary -O ihex --change-addresses 0x08000000 $OutBin $OutHex
if ($LASTEXITCODE -ne 0) { throw "objcopy hex failed" }
Write-Host "factory $($out.Length) bytes -> $OutBin"
