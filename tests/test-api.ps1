[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

Write-Host "Отправляем 3 сообщения одновременно..." -ForegroundColor Green

# Создаем 3 задачи для параллельной отправки
$jobs = @()

for ($i = 1; $i -le 3; $i++) {
    $body = @{
        chatName = "test"
        message = "Сообщение номер $i из API"
    } | ConvertTo-Json -Depth 10
    
    $jobs += Start-Job -ScriptBlock {
        param($body, $index)
        
        $response = Invoke-RestMethod -Uri "http://localhost:3999/api/send" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
        
        return @{
            Index = $index
            Response = $response
        }
    } -ArgumentList $body, $i
}

Write-Host "Ожидаем ответы..." -ForegroundColor Yellow

# Ждем завершения всех задач
$results = $jobs | Wait-Job | Receive-Job

# Выводим результаты
foreach ($result in $results) {
    Write-Host "`nСообщение $($result.Index):" -ForegroundColor Cyan
    $result.Response | ConvertTo-Json
}

# Очищаем задачи
$jobs | Remove-Job

Write-Host "`nПроверяем статус очереди..." -ForegroundColor Green
$queueStatus = Invoke-RestMethod -Uri "http://localhost:3000/api/queue" -Method Get
$queueStatus | ConvertTo-Json
