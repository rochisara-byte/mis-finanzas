$ErrorActionPreference = 'Stop'
$port = 8768
$url = "http://127.0.0.1:$port/"
$page = Join-Path $PSScriptRoot 'calendar-live-sandbox.html'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

try {
    $listener.Start()
} catch {
    Write-Host "No se pudo iniciar el ensayo en $url. Cierra otro programa que use el puerto $port."
    exit 1
}

Write-Host "Ensayo local disponible en $url"
Write-Host 'Esta ventana solo sirve la pagina de ensayo. Para detenerla, cerrala.'
Start-Process $url

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $firstLine = $reader.ReadLine()
            while ($null -ne ($line = $reader.ReadLine()) -and $line -ne '') { }
            $allowed = $firstLine -match '^GET (/|/calendar-live-sandbox\.html)(\?.*)? HTTP/1\.[01]$'
            if ($allowed) {
                $body = [System.IO.File]::ReadAllBytes($page)
                $header = "HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            } else {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
                $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            }
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($body, 0, $body.Length)
            $reader.Dispose()
        } catch {
            Write-Host 'Una solicitud local no se pudo atender; la pagina sigue disponible.'
        } finally {
            $client.Dispose()
        }
    }
} finally {
    $listener.Stop()
}
