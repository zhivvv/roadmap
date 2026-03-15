const STATUS_COLORS = {
  planned: "#91a3b5",
  active: "#2e8b78",
  done: "#5676d6",
};

const REQUIRED_TASK_COLUMNS = ["project", "work", "owner", "date_start", "date_finish"];
const REQUIRED_MILESTONE_COLUMNS = ["project", "milestone_name", "milestone_date"];
const REQUIRED_BOARD_COLUMNS = ["project", "board_name", "board_date"];
const BOARD_TYPES = {
  IKK: { label: "ИКК", icon: "К" },
  IK: { label: "ИК", icon: "И" },
  UK: { label: "УК", icon: "У" },
  PREDUK: { label: "предУК", icon: "П" },
};

const BOARD_ALIASES = {
  "ИКК": "IKK",
  "ИК": "IK",
  "УК": "UK",
  "ПРЕДУК": "PREDUK",
  "ПРЕД УК": "PREDUK",
  "ИНВЕСТКОМИТЕТ": "IKK",
  "АРХИТЕКТУРНЫЙ КОМИТЕТ": "IK",
  "УПРАВЛЯЮЩИЙ КОМИТЕТ": "UK",
  "МАРКЕТИНГОВЫЙ КОМИТЕТ": "IKK",
  "ОПЕРАЦИОННЫЙ КОМИТЕТ": "UK",
};

const dom = {
  roadmap: document.querySelector("#roadmap"),
  summary: document.querySelector("#summary"),
  legend: document.querySelector("#legend"),
  statusText: document.querySelector("#status-text"),
  projectFilter: document.querySelector("#project-filter"),
  dateStart: document.querySelector("#date-start"),
  dateEnd: document.querySelector("#date-end"),
  layerFilter: document.querySelector("#layer-filter"),
};

let allTasks = [];
let allMilestones = [];
let allBoards = [];
let activeProject = "all";
let activeTaskId = null;
let selectedDateStart = null;
let selectedDateEnd = null;
let visibleLayers = {
  tasks: true,
  milestones: true,
  boards: true,
};

function boot() {
  renderLegend();
  renderLayerFilter();
  loadFolderData();
}

async function loadFolderData() {
  try {
    dom.statusText.textContent = "Загружаю данные...";

    const manifestResponse = await fetch("./data/files.json", { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error("Не найден файл data/files.json со списком исходных файлов.");
    }

    const manifest = await manifestResponse.json();
    const scheduleFiles = Array.isArray(manifest.schedule_files) ? manifest.schedule_files : [];
    const milestoneFile = manifest.milestone_file;
    const boardFile = manifest.board_file;

    if (!scheduleFiles.length) {
      throw new Error("В data/files.json не перечислены файлы графика.");
    }

    if (!milestoneFile) {
      throw new Error("В data/files.json не указан файл вех.");
    }

    if (!boardFile) {
      throw new Error("В data/files.json не указан файл колл. органов.");
    }

    const loadedTasks = await Promise.all(scheduleFiles.map(loadTaskFile));
    allTasks = mergeTasks(loadedTasks.flatMap((group) => group.rows));
    allMilestones = await loadMilestoneFile(milestoneFile);
    allBoards = await loadBoardFile(boardFile);

    if (!allTasks.length) {
      throw new Error("В папке data нет строк графика для отображения.");
    }

    initializeDateFilter(allTasks, allMilestones);
    renderProjectFilter(allTasks);
    updateDashboard();
    dom.statusText.textContent = `Загружено ${scheduleFiles.length} файлов графика, файл вех ${milestoneFile} и файл колл. органов ${boardFile}.`;
  } catch (error) {
    renderError(error.message);
  }
}

async function loadTaskFile(fileName) {
  const rawRows = await loadTableRows(fileName);
  return {
    fileName,
    rows: normalizeTaskRows(rawRows, fileName),
  };
}

async function loadMilestoneFile(fileName) {
  const rawRows = await loadTableRows(fileName);
  return normalizeMilestoneRows(rawRows, fileName);
}

async function loadBoardFile(fileName) {
  const rawRows = await loadTableRows(fileName);
  return normalizeBoardRows(rawRows, fileName);
}

async function loadTableRows(fileName) {
  const response = await fetch(`./data/${fileName}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить файл ${fileName}.`);
  }

  const extension = fileName.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return parseCsv(await response.text());
  }

  if (extension === "xlsx") {
    return parseXlsx(await response.arrayBuffer());
  }

  throw new Error(`Формат файла ${fileName} не поддерживается. Используйте CSV или XLSX.`);
}

function parseXlsx(buffer) {
  if (!window.XLSX) {
    throw new Error(
      "Библиотека для XLSX не загрузилась. Проверьте подключение к интернету или используйте CSV."
    );
  }

  const workbook = window.XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(firstSheet, {
    defval: "",
    raw: false,
  });
}

function parseCsv(source) {
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const separator = detectSeparator(lines);
  const rows = [];
  let current = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < lines.length; i += 1) {
    const char = lines[i];
    const nextChar = lines[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      record.push(current);
      current = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      record.push(current);
      rows.push(record);
      record = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || record.length) {
    record.push(current);
    rows.push(record);
  }

  const [headerRow, ...bodyRows] = rows.filter((row) =>
    row.some((cell) => String(cell).trim() !== "")
  );

  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map(normalizeHeader);
  return bodyRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, (row[index] || "").trim()]))
  );
}

function detectSeparator(text) {
  const firstLine = text.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return ",";
  }

  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeTaskRows(rows, fileName) {
  if (!rows.length) {
    return [];
  }

  const missing = REQUIRED_TASK_COLUMNS.filter((column) => !(column in rows[0]));
  if (missing.length) {
    throw new Error(`В файле ${fileName} не хватает колонок: ${missing.join(", ")}`);
  }

  return rows.map((row, index) => {
    const start = parseDate(row.date_start);
    const end = parseDate(row.date_finish);

    if (!start || !end) {
      throw new Error(`Некорректная дата в ${fileName}, строка ${index + 2}. Используйте YYYY-MM-DD.`);
    }

    if (start > end) {
      throw new Error(`Дата начала позже даты окончания в ${fileName}, строка ${index + 2}.`);
    }

    return {
      id: `${fileName}-${row.project}-${row.work}-${index}`,
      fileName,
      project: String(row.project).trim(),
      work: String(row.work).trim(),
      owner: String(row.owner).trim(),
      start,
      end,
      status: getStatusByDate(start, end),
      durationDays: daysBetween(start, end) + 1,
    };
  });
}

function mergeTasks(tasks) {
  const merged = new Map();

  tasks.forEach((task) => {
    const key = `${task.project}:::${task.work}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        ...task,
        owners: new Set([task.owner]),
        sourceFiles: new Set([task.fileName]),
      });
      return;
    }

    existing.start = existing.start < task.start ? existing.start : task.start;
    existing.end = existing.end > task.end ? existing.end : task.end;
    existing.owners.add(task.owner);
    existing.sourceFiles.add(task.fileName);
    existing.status = getStatusByDate(existing.start, existing.end);
    existing.durationDays = daysBetween(existing.start, existing.end) + 1;
    existing.id = `${existing.project}-${existing.work}`;
  });

  return [...merged.values()]
    .map((task) => ({
      ...task,
      id: `${task.project}-${task.work}`,
      ownerList: [...task.owners].sort((a, b) => a.localeCompare(b, "ru")),
      owner: [...task.owners].sort((a, b) => a.localeCompare(b, "ru")).join(", "),
      fileName: [...task.sourceFiles].sort((a, b) => a.localeCompare(b, "ru")).join(", "),
    }))
    .sort((a, b) => a.start - b.start);
}

function normalizeMilestoneRows(rows, fileName) {
  if (!rows.length) {
    return [];
  }

  const missing = REQUIRED_MILESTONE_COLUMNS.filter((column) => !(column in rows[0]));
  if (missing.length) {
    throw new Error(`В файле ${fileName} не хватает колонок: ${missing.join(", ")}`);
  }

  return rows.map((row, index) => {
    const date = parseDate(row.milestone_date);
    if (!date) {
      throw new Error(`Некорректная дата в ${fileName}, строка ${index + 2}. Используйте YYYY-MM-DD.`);
    }

    return {
      id: `${fileName}-${row.project}-${row.milestone_name}-${index}`,
      project: String(row.project).trim(),
      milestoneName: String(row.milestone_name).trim(),
      date,
    };
  });
}

function normalizeBoardRows(rows, fileName) {
  if (!rows.length) {
    return [];
  }

  const missing = REQUIRED_BOARD_COLUMNS.filter((column) => !(column in rows[0]));
  if (missing.length) {
    throw new Error(`В файле ${fileName} не хватает колонок: ${missing.join(", ")}`);
  }

  return rows.map((row, index) => {
    const date = parseDate(row.board_date);
    if (!date) {
      throw new Error(`Некорректная дата в ${fileName}, строка ${index + 2}. Используйте YYYY-MM-DD.`);
    }

    const boardType = normalizeBoardType(row.board_name);

    return {
      id: `${fileName}-${row.project}-${row.board_name}-${index}`,
      project: String(row.project).trim(),
      boardName: boardType.label,
      boardKey: boardType.key,
      boardIcon: boardType.icon,
      date,
    };
  });
}

function parseDate(value) {
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStatusByDate(start, end) {
  const today = new Date();
  const point = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (end < point) {
    return "done";
  }

  if (start > point) {
    return "planned";
  }

  return "active";
}

function renderLegend() {
  dom.legend.innerHTML = `
    <div class="legend__item">
      <span class="legend__dot" style="background:${STATUS_COLORS.planned}"></span>
      <span>Запланировано</span>
    </div>
    <div class="legend__item">
      <span class="legend__dot" style="background:${STATUS_COLORS.active}"></span>
      <span>Активные</span>
    </div>
    <div class="legend__item">
      <span class="legend__dot" style="background:${STATUS_COLORS.done}"></span>
      <span>Завершенные</span>
    </div>
    <div class="legend__item">
      <span class="legend__star">★</span>
      <span>Веха</span>
    </div>
    <div class="legend__item">
      <span class="legend__board-icon">${BOARD_TYPES.IKK.icon}</span>
      <span>ИКК</span>
    </div>
    <div class="legend__item">
      <span class="legend__board-icon">${BOARD_TYPES.IK.icon}</span>
      <span>ИК</span>
    </div>
    <div class="legend__item">
      <span class="legend__board-icon">${BOARD_TYPES.UK.icon}</span>
      <span>УК</span>
    </div>
    <div class="legend__item">
      <span class="legend__board-icon">${BOARD_TYPES.PREDUK.icon}</span>
      <span>предУК</span>
    </div>
  `;
}

function renderLayerFilter() {
  dom.layerFilter.innerHTML = `
    <label class="layer-filter__item">
      <input type="checkbox" data-layer="tasks" ${visibleLayers.tasks ? "checked" : ""} />
      <span>Только работы</span>
    </label>
    <label class="layer-filter__item">
      <input type="checkbox" data-layer="milestones" ${visibleLayers.milestones ? "checked" : ""} />
      <span>Только вехи</span>
    </label>
    <label class="layer-filter__item">
      <input type="checkbox" data-layer="boards" ${visibleLayers.boards ? "checked" : ""} />
      <span>Только колл. органы</span>
    </label>
  `;

  dom.layerFilter.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      visibleLayers[input.dataset.layer] = input.checked;
      updateDashboard();
    });
  });
}

function initializeDateFilter(tasks, milestones) {
  const bounds = getBounds(tasks, milestones);
  selectedDateStart = bounds.start;
  selectedDateEnd = bounds.end;
  dom.dateStart.value = formatInputMonth(bounds.start);
  dom.dateEnd.value = formatInputMonth(bounds.end);

  dom.dateStart.addEventListener("change", handleDateChange);
  dom.dateEnd.addEventListener("change", handleDateChange);
}

function handleDateChange() {
  const start = parseMonthValue(dom.dateStart.value);
  const end = parseMonthValue(dom.dateEnd.value, true);

  if (!start || !end) {
    return;
  }

  if (start <= end) {
    selectedDateStart = start;
    selectedDateEnd = end;
  } else {
    selectedDateStart = end;
    selectedDateEnd = start;
    dom.dateStart.value = formatInputMonth(selectedDateStart);
    dom.dateEnd.value = formatInputMonth(selectedDateEnd);
  }

  activeTaskId = null;
  updateDashboard();
}

function renderProjectFilter(items) {
  const projects = [...new Set(items.map((item) => item.project))].sort((a, b) =>
    a.localeCompare(b, "ru")
  );

  dom.projectFilter.innerHTML = [
    renderProjectChip("all", "Все проекты", activeProject === "all"),
    ...projects.map((project) =>
      renderProjectChip(project, project, project === activeProject)
    ),
  ].join("");

  dom.projectFilter.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      activeProject = button.dataset.project;
      activeTaskId = null;
      renderProjectFilter(allTasks);
      updateDashboard();
    });
  });
}

function renderProjectChip(value, label, isActive) {
  return `
    <button
      class="filter-chip${isActive ? " is-active" : ""}"
      type="button"
      data-project="${escapeHtml(value)}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function updateDashboard() {
  const filteredTasks = getFilteredTasks();
  const filteredMilestones = getFilteredMilestones();
  const filteredBoards = getFilteredBoards();
  renderSummary(filteredTasks, filteredMilestones, filteredBoards);
  renderRoadmap(filteredTasks, filteredMilestones, filteredBoards);
}

function getFilteredTasks() {
  return allTasks.filter((item) => {
    const matchesProject = activeProject === "all" || item.project === activeProject;
    const matchesDate =
      !selectedDateStart ||
      !selectedDateEnd ||
      (item.end >= selectedDateStart && item.start <= selectedDateEnd);
    return matchesProject && matchesDate;
  });
}

function getFilteredMilestones() {
  return allMilestones.filter((item) => {
    const matchesProject = activeProject === "all" || item.project === activeProject;
    const matchesDate =
      !selectedDateStart || !selectedDateEnd || (item.date >= selectedDateStart && item.date <= selectedDateEnd);
    return matchesProject && matchesDate;
  });
}

function getFilteredBoards() {
  return allBoards.filter((item) => {
    const matchesProject = activeProject === "all" || item.project === activeProject;
    const matchesDate =
      !selectedDateStart || !selectedDateEnd || (item.date >= selectedDateStart && item.date <= selectedDateEnd);
    return matchesProject && matchesDate;
  });
}

function renderSummary(tasks, milestones, boards) {
  const totalProjects =
    activeProject === "all" ? new Set(tasks.map((item) => item.project)).size : tasks.length ? 1 : 0;
  const active = tasks.filter((item) => item.status === "active").length;

  dom.summary.innerHTML = `
    <article class="summary-card">
      <strong>${totalProjects}</strong>
      <span>${activeProject === "all" ? "Проектов" : "Выбран проект"}</span>
    </article>
    <article class="summary-card">
      <strong>${tasks.length}</strong>
      <span>Работ</span>
    </article>
    <article class="summary-card">
      <strong>${milestones.length}</strong>
      <span>Вех</span>
    </article>
    <article class="summary-card">
      <strong>${boards.length}</strong>
      <span>Колл. органов</span>
    </article>
    <article class="summary-card">
      <strong>${active}</strong>
      <span>Активных работ</span>
    </article>
  `;
}

function renderRoadmap(tasks, milestones, boards) {
  if (!tasks.length && !milestones.length && !boards.length) {
    dom.roadmap.innerHTML = `
      <div class="empty-state">
        <h3>Нет данных по выбранному фильтру</h3>
        <p>Выберите другой проект или проверьте исходные таблицы.</p>
      </div>
    `;
    return;
  }

  const bounds = getBounds(tasks, milestones, boards);
  const months = buildMonths(bounds.start, bounds.end);
  const grouped = groupByProject(tasks);
  const monthWidth = getMonthWidth(months.length);

  dom.roadmap.innerHTML = `
    <div class="roadmap-grid" style="--month-count:${months.length}; --month-width:${monthWidth}px;">
      <div class="roadmap-header">
        <div class="corner-cell">Проект / Работа</div>
        <div class="months">
          ${renderTodayLine(bounds.start, bounds.end, true)}
          ${months
            .map(
              (month) =>
                `<div class="month-cell">${month.toLocaleDateString("ru-RU", {
                  month: "short",
                  year: "numeric",
                })}</div>`
            )
            .join("")}
        </div>
      </div>
      ${buildProjectSections(grouped, milestones, boards, bounds.start, bounds.end)}
    </div>
  `;

  dom.roadmap.querySelectorAll(".task-bar").forEach((bar) => {
    bar.addEventListener("click", () => {
      activeTaskId = bar.dataset.id === activeTaskId ? null : bar.dataset.id;
      syncTaskSelection();
    });
  });

  syncTaskSelection();
}

function buildProjectSections(groupedTasks, milestones, boards, timelineStart, timelineEnd) {
  const allProjects = new Set([
    ...groupedTasks.map(([project]) => project),
    ...milestones.map((item) => item.project),
    ...boards.map((item) => item.project),
  ]);

  return [...allProjects]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((project) => {
      const tasks = groupedTasks.find(([name]) => name === project)?.[1] || [];
      const projectMilestones = milestones.filter((item) => item.project === project);
      const projectBoards = boards.filter((item) => item.project === project);

      return `
        <section class="project-row">
          <div class="lane-stream">${escapeHtml(project)}</div>
          ${visibleLayers.milestones ? renderMilestoneRow(projectMilestones, timelineStart, timelineEnd) : ""}
          ${visibleLayers.boards ? renderBoardRow(projectBoards, timelineStart, timelineEnd) : ""}
          ${visibleLayers.tasks ? tasks.map((task) => renderTaskRow(task, timelineStart, timelineEnd)).join("") : ""}
        </section>
      `;
    })
    .join("");
}

function renderTaskRow(task, timelineStart, timelineEnd) {
  return `
    <div class="lane-row">
      <div class="lane-label">
        <strong>${escapeHtml(task.work)}</strong>
      </div>
      <div class="lane-track">
        ${renderTodayLine(timelineStart, timelineEnd)}
        ${renderTaskBar(task, timelineStart, timelineEnd)}
      </div>
    </div>
  `;
}

function renderMilestoneRow(milestones, timelineStart, timelineEnd) {
  if (!milestones.length) {
    return "";
  }

  return `
    <div class="lane-row lane-row--milestones">
      <div class="lane-label">
        <strong>Вехи</strong>
      </div>
      <div class="lane-track lane-track--milestones">
        ${renderTodayLine(timelineStart, timelineEnd)}
        ${milestones.map((item) => renderMilestone(item, timelineStart)).join("")}
      </div>
    </div>
  `;
}

function renderBoardRow(boards, timelineStart, timelineEnd) {
  if (!boards.length) {
    return "";
  }

  return `
    <div class="lane-row lane-row--boards">
      <div class="lane-label">
        <strong>Колл. органы</strong>
      </div>
      <div class="lane-track lane-track--boards">
        ${renderTodayLine(timelineStart, timelineEnd)}
        ${boards.map((item) => renderBoard(item, timelineStart)).join("")}
      </div>
    </div>
  `;
}

function renderTaskBar(task, timelineStart, timelineEnd) {
  const visibleStart = maxDate(task.start, timelineStart);
  const visibleEnd = minDate(task.end, timelineEnd);
  const left = getTimelineUnit(visibleStart, timelineStart, "start");
  const right = getTimelineUnit(visibleEnd, timelineStart, "end");
  const width = Math.max(right - left, 0.1);
  const color = STATUS_COLORS[task.status];

  return `
    <button
      class="task-bar"
      type="button"
      data-id="${escapeHtml(task.id)}"
      title="${escapeHtml(task.work)} | ${escapeHtml(task.owner)} | ${formatDate(task.start)} - ${formatDate(task.end)}"
      style="
        left: calc(${left} * var(--month-width));
        width: max(calc(${width} * var(--month-width)), 40px);
        background: ${color};
      "
    >
      <span class="task-bar__duration">${escapeHtml(task.durationDays)} дн.</span>
    </button>
  `;
}

function renderMilestone(item, timelineStart) {
  const left = getTimelineUnit(item.date, timelineStart, "mid");

  return `
    <div
      class="milestone"
      title="${escapeHtml(item.milestoneName)} | ${formatDate(item.date)}"
      style="left: calc(${left} * var(--month-width));"
    >
      <span class="milestone__star">★</span>
      <span class="milestone__label">${escapeHtml(item.milestoneName)} ${formatShortDate(item.date)}</span>
    </div>
  `;
}

function renderBoard(item, timelineStart) {
  const left = getTimelineUnit(item.date, timelineStart, "mid");

  return `
    <div
      class="board-marker"
      title="${escapeHtml(item.boardName)} | ${formatDate(item.date)}"
      style="left: calc(${left} * var(--month-width));"
    >
      <span class="board-marker__square">${escapeHtml(item.boardIcon)}</span>
      <span class="board-marker__label">${escapeHtml(item.boardName)} ${formatShortDate(item.date)}</span>
    </div>
  `;
}

function renderTodayLine(start, end, isHeader = false) {
  const today = startOfDay(new Date());
  if (today < start || today > end) {
    return "";
  }

  const left = getTimelineUnit(today, start, "mid");
  return `
    <div class="today-line" style="left: calc(${left} * var(--month-width));">
      ${isHeader ? '<span class="today-line__label">Сегодня</span>' : ""}
    </div>
  `;
}

function syncTaskSelection() {
  dom.roadmap.querySelectorAll(".task-bar").forEach((bar) => {
    bar.classList.toggle("is-active", bar.dataset.id === activeTaskId);
  });
}

function renderError(message) {
  dom.statusText.textContent = message;
  dom.summary.innerHTML = "";
  dom.projectFilter.innerHTML = "";
  dom.roadmap.innerHTML = `
    <div class="empty-state">
      <h3>Не удалось загрузить данные</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function getBounds(tasks, milestones, boards = []) {
  if (selectedDateStart && selectedDateEnd) {
    return {
      start: new Date(selectedDateStart.getFullYear(), selectedDateStart.getMonth(), 1),
      end: new Date(selectedDateEnd.getFullYear(), selectedDateEnd.getMonth() + 1, 0),
    };
  }

  const taskStarts = tasks.map((item) => item.start.getTime());
  const taskEnds = tasks.map((item) => item.end.getTime());
  const milestoneDates = milestones.map((item) => item.date.getTime());
  const boardDates = boards.map((item) => item.date.getTime());
  const allStarts = [...taskStarts, ...milestoneDates, ...boardDates];
  const allEnds = [...taskEnds, ...milestoneDates, ...boardDates];
  const start = new Date(Math.min(...allStarts));
  const end = new Date(Math.max(...allEnds));

  return {
    start: new Date(start.getFullYear(), start.getMonth(), 1),
    end: new Date(end.getFullYear(), end.getMonth() + 1, 0),
  };
}

function buildMonths(start, end) {
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function getMonthWidth(monthCount) {
  const available = Math.max(window.innerWidth - 520, 420);
  const fitted = Math.floor(available / Math.max(monthCount, 1));
  return Math.max(96, Math.min(132, fitted));
}

function groupByProject(items) {
  const projects = new Map();

  items
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((item) => {
      if (!projects.has(item.project)) {
        projects.set(item.project, []);
      }

      projects.get(item.project).push(item);
    });

  return [...projects.entries()];
}

function formatDate(date) {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatShortDate(date) {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function formatInputMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysBetween(start, end) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.round((end - start) / millisecondsPerDay);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseMonthValue(value, endOfMonth = false) {
  if (!/^\d{4}-\d{2}$/.test(String(value).trim())) {
    return null;
  }

  const [year, month] = value.split("-").map(Number);
  return endOfMonth ? new Date(year, month, 0) : new Date(year, month - 1, 1);
}

function normalizeBoardType(value) {
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, " ");
  const normalized = BOARD_ALIASES[raw] || raw;

  if (!BOARD_TYPES[normalized]) {
    throw new Error(
      "Допустимые значения колл. органа: ИКК, ИК, УК, предУК. Также поддерживаются старые названия из примеров."
    );
  }

  return {
    key: normalized,
    ...BOARD_TYPES[normalized],
  };
}

function minDate(left, right) {
  return left <= right ? left : right;
}

function maxDate(left, right) {
  return left >= right ? left : right;
}

function getTimelineUnit(date, timelineStart, mode = "start") {
  const monthOffset =
    (date.getFullYear() - timelineStart.getFullYear()) * 12 +
    (date.getMonth() - timelineStart.getMonth());
  const daysInCurrentMonth = getDaysInMonth(date);

  if (mode === "end") {
    return monthOffset + date.getDate() / daysInCurrentMonth;
  }

  if (mode === "mid") {
    return monthOffset + (date.getDate() - 0.5) / daysInCurrentMonth;
  }

  return monthOffset + (date.getDate() - 1) / daysInCurrentMonth;
}

function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

boot();
