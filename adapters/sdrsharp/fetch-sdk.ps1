$ErrorActionPreference = "Stop"
$url = "https://airspy.com/?ddownload=5944"
$expected = "9680D85714A14F53B046B5651664A10153604CC91D85F18B3EB9580E703B8935"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "sdrsharp-plugin-sdk-1921.zip"
$expanded = Join-Path ([System.IO.Path]::GetTempPath()) "sdrsharp-plugin-sdk-1921"
Invoke-WebRequest -Uri $url -OutFile $temporary
$actual = (Get-FileHash -Algorithm SHA256 $temporary).Hash
if ($actual -ne $expected) { throw "SDR# SDK checksum changed: $actual" }
if (Test-Path $expanded) { Remove-Item -Recurse -Force $expanded }
Expand-Archive -Path $temporary -DestinationPath $expanded
$destination = Join-Path $PSScriptRoot "lib"
New-Item -ItemType Directory -Force $destination | Out-Null
Copy-Item (Join-Path $expanded "sdrplugins/lib/SDRSharp.Common.dll") $destination
Copy-Item (Join-Path $expanded "sdrplugins/lib/SDRSharp.Radio.dll") $destination
Write-Host "SDK references installed in $destination"

