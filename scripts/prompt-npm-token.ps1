# Local hidden prompt for NPM_TOKEN. Never prints the token.
# Writes it to a caller-supplied file, then exits.
param(
  [Parameter(Mandatory = $true)]
  [string]$OutFile
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "AgentTab npm publish"
$form.Size = New-Object System.Drawing.Size(520, 200)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(16, 16)
$label.Size = New-Object System.Drawing.Size(470, 40)
$label.Text = "Paste the npm granular token here (hidden). It stays on this machine and is not sent to chat."
$form.Controls.Add($label)

$box = New-Object System.Windows.Forms.TextBox
$box.Location = New-Object System.Drawing.Point(16, 64)
$box.Size = New-Object System.Drawing.Size(470, 28)
$box.UseSystemPasswordChar = $true
$form.Controls.Add($box)

$ok = New-Object System.Windows.Forms.Button
$ok.Text = "Publish 0.1.2"
$ok.Location = New-Object System.Drawing.Point(290, 110)
$ok.Size = New-Object System.Drawing.Size(110, 28)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $ok
$form.Controls.Add($ok)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Location = New-Object System.Drawing.Point(410, 110)
$cancel.Size = New-Object System.Drawing.Size(76, 28)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancel
$form.Controls.Add($cancel)

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Output "cancelled"
  exit 2
}

$token = $box.Text.Trim()
$box.Text = ""
$form.Dispose()
if ($token.Length -lt 20) {
  Write-Output "token_too_short"
  exit 3
}

$dir = Split-Path -Parent $OutFile
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}
Set-Content -Path $OutFile -Value $token -NoNewline -Encoding ascii
icacls $OutFile /inheritance:r /grant:r "$env:USERNAME:(R)" | Out-Null
Write-Output "token_saved"
exit 0
