# График реализации проектов

Небольшое веб-приложение на JavaScript для отображения проектных графиков из таблиц.

## Как запустить

Запустите локальный HTTP-сервер в папке проекта:

```bash
cd /Users/zhivvv/PythonProjects/roadmap
python3 -m http.server 8000
```

Потом откройте `http://localhost:8000`.

## Формат данных

Приложение автоматически читает все `csv` и `xlsx`, перечисленные в `/Users/zhivvv/PythonProjects/roadmap/data/files.json`.

В `files.json` теперь используются поля:

- `schedule_files` - массив файлов с работами проектов
- `milestone_file` - отдельный файл с вехами
- `board_file` - отдельный файл с выходами на колл. органы

В файлах графика нужны колонки:

- `project` - проект
- `work` - работа или этап
- `owner` - ответственный
- `date_start` - дата начала в формате `YYYY-MM-DD`
- `date_finish` - дата окончания в формате `YYYY-MM-DD`

В файле вех нужны колонки:

- `project` - проект
- `milestone_name` - название вехи
- `milestone_date` - дата вехи в формате `YYYY-MM-DD`

В файле колл. органов нужны колонки:

- `project` - проект
- `board_name` - название колл. органа, допустимые значения: `ИКК`, `ИК`, `УК`, `предУК`
- `board_date` - дата колл. органа в формате `YYYY-MM-DD`

Примеры лежат в:

- `/Users/zhivvv/PythonProjects/roadmap/data/example-roadmap.csv`
- `/Users/zhivvv/PythonProjects/roadmap/data/team-ops.csv`
- `/Users/zhivvv/PythonProjects/roadmap/data/project-milestones.csv`
- `/Users/zhivvv/PythonProjects/roadmap/data/project-boards.csv`

## Что умеет

- автоматическая загрузка всех файлов из папки `data`, указанных в `files.json`
- парсинг `csv` без зависимостей
- импорт `xlsx` через SheetJS CDN
- объединение данных из нескольких файлов
- отдельный источник вех, синхронизированных с проектами по полю `project`
- отдельный источник выходов на колл. органы, синхронизированных с проектами по полю `project`
- фильтрация по проектам прямо в интерфейсе
- компактный календарный график в стиле Gantt
- отображение вех как звездочек на той же дорожной карте
- отображение выходов на колл. органы как квадратных маркеров на отдельной строке
- автоматическое определение статуса по текущей дате
