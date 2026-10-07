<#
    ВАЖНО: файл лежит в UTF-8 С BOM. Без BOM Windows PowerShell читает его
    как ANSI, русский текст рассыпается и скрипт даже не разбирается.
    Правя файл, проверьте, что BOM на месте.

    Ставит задачи Планировщика Windows на обновление данных с mpt.ru:
        - расписание — раз в 12 часов
        - замены     — раз в 30 минут (преподаватели правят в течение дня)

        powershell -ExecutionPolicy Bypass -File tools\install-task.ps1
        powershell -ExecutionPolicy Bypass -File tools\install-task.ps1 -Uninstall
        powershell -ExecutionPolicy Bypass -File tools\install-task.ps1 -RunNow
#>
param(
    [int]$Hours = 12,
    [int]$ReplacementsMinutes = 30,
    [switch]$Uninstall,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# name, script, интервал в минутах, что пишет, человеческое имя
$Jobs = @(
    @{
        Name = "MPT-Raspisanie-Update"
        Script = "tools\fetch-schedule.mjs"
        EveryMinutes = $Hours * 60
        Writes = "data\schedule.js"
        Title = "расписание"
    },
    @{
        Name = "MPT-Zameny-Update"
        Script = "tools\fetch-replacements.mjs"
        EveryMinutes = $ReplacementsMinutes
        Writes = "data\replacements.js"
        Title = "замены"
    }
)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "node не найден в PATH. Установи Node.js и открой консоль заново."
}
$node = (Get-Command node).Source

function Remove-Jobs($jobs) {
    foreach ($j in $jobs) {
        if (Get-ScheduledTask -TaskName $j.Name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $j.Name -Confirm:$false
            "Задача «$($j.Name)» ($($j.Title)) удалена."
        }
        else {
            "Задача «$($j.Name)» не найдена."
        }
    }
}

if ($Uninstall) {
    Remove-Jobs $Jobs
    return
}

if ($RunNow) {
    Push-Location $root
    try {
        foreach ($j in $Jobs) { & node (Join-Path $root $j.Script) }
    } finally { Pop-Location }
    return
}

foreach ($j in $Jobs) {
    $script = Join-Path $root $j.Script
    if (-not (Test-Path $script)) { throw "Не найден скрипт: $script" }

    $action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes $j.EveryMinutes) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    # Interactive: задача выполняется, когда ты залогинен, пароль хранить не нужно
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null

    # Интервал показываем в часах, только если он кратен часу: у замен он
    # получасовой, и «каждые 0 ч» читалось бы как ошибка.
    $every = "$($j.EveryMinutes) мин"
    if ($j.EveryMinutes -ge 60 -and $j.EveryMinutes % 60 -eq 0) {
        $every = "$([int]($j.EveryMinutes / 60)) ч"
    }
    # Собираем строку целиком: «+» в начале следующей строки PowerShell
    # читает как унарный плюс и роняет весь цикл на первой же задаче.
    $startAt = (Get-Date).AddMinutes(1).ToString("HH:mm")
    "Задача «$($j.Name)» создана: $($j.Title) — $every, начиная с $startAt"
}

""
"Откуда:     $root"
"Пишет:      расписание -> data\schedule.js, замены -> data\replacements.js"
"История:    data\last-update.log"
""
"Проверить запуск сейчас:  powershell -ExecutionPolicy Bypass -File tools\install-task.ps1 -RunNow"
"Убрать задачи:            powershell -ExecutionPolicy Bypass -File tools\install-task.ps1 -Uninstall"