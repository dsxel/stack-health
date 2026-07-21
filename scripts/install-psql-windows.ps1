param(
  [switch]$Install
)

# Prints a recommended install command for PostgreSQL on Windows and optionally runs it.
if (Get-Command winget -ErrorAction SilentlyContinue) {
  $cmd = 'winget install -e --id PostgreSQL.Postgres'
} elseif (Get-Command choco -ErrorAction SilentlyContinue) {
  $cmd = 'choco install postgresql --yes'
} else {
  Write-Host "No winget or choco detected. Download PostgreSQL installer: https://www.postgresql.org/download/windows/"
  exit 1
}

Write-Host "Recommended command: $cmd"
Write-Host "Run this PowerShell script with -Install to execute the command (requires elevation)."

if ($Install) {
  Write-Host "Executing: $cmd"
  iex $cmd
}
