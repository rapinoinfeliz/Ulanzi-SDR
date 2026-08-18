$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "SDRSharp.UlanziAdapter.csproj"

& (Join-Path $PSScriptRoot "fetch-sdk.ps1")
dotnet build $project --configuration Release

Write-Host "SDR# adapter built successfully."
