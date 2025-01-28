// ------------------------------------------------------------------------------------------
// Global thresholds (will get updated by UI inputs)
let offsetThresholdAlmost = 1;
let offsetThresholdVeryWrong = 3;
let highConfidenceThreshold = 0.75;
let lowConfidenceThreshold = 0.25;

// Loaded data
let allSamples = [];

document.addEventListener("DOMContentLoaded", () => {
  // Fetch the massive JSON
  fetch("data/samples.json")
    .then(resp => resp.json())
    .then(data => {
      allSamples = data;

      // Precompute per-sample stats
      allSamples.forEach(computeSampleStats);

      // Setup UI listeners
      setupUI();

      // Initial render
      applyFiltersAndRender();
    })
    .catch(err => {
      console.error("Failed to load data:", err);
      document.getElementById("global-stats").textContent = 
        "Error: Could not load samples.json.";
    });
});

// ------------------------------------------------------------------------------------------
// Compute min/mean/max/std for offset & confidence across windows
// ------------------------------------------------------------------------------------------
function computeSampleStats(sample) {
  const w = sample.window_metrics || [];
  const offsets = [];
  const confs = [];

  w.forEach(win => {
    if (typeof win.offset_from_correct === "number") offsets.push(win.offset_from_correct);
    if (typeof win.confidence === "number") confs.push(win.confidence);
  });

  sample.stats = {
    offset: getStats(offsets),
    confidence: getStats(confs),
  };
}

function getStats(values) {
  if (!values.length) {
    return { min: null, max: null, mean: null, std: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
  return {
    min,
    max,
    mean,
    std: Math.sqrt(variance),
  };
}

// ------------------------------------------------------------------------------------------
// UI Setup
// ------------------------------------------------------------------------------------------
function setupUI() {
  // Threshold inputs
  document.getElementById("offset-threshold-almost").addEventListener("change", (e) => {
    offsetThresholdAlmost = parseFloat(e.target.value) || 1;
    applyFiltersAndRender();
  });
  document.getElementById("offset-threshold-verywrong").addEventListener("change", (e) => {
    offsetThresholdVeryWrong = parseFloat(e.target.value) || 3;
    applyFiltersAndRender();
  });
  document.getElementById("conf-threshold-high").addEventListener("change", (e) => {
    highConfidenceThreshold = parseFloat(e.target.value) || 0.75;
    applyFiltersAndRender();
  });
  document.getElementById("conf-threshold-low").addEventListener("change", (e) => {
    lowConfidenceThreshold = parseFloat(e.target.value) || 0.25;
    applyFiltersAndRender();
  });

  // Checkboxes
  [
    "filter-correct",
    "filter-almost",
    "filter-incorrect",
    "filter-confident",
    "filter-unconfident",
    "filter-majority-wrong-final-correct",
  ].forEach((id) => {
    document.getElementById(id).addEventListener("change", applyFiltersAndRender);
  });

  // Sample index filter
  document.getElementById("btn-apply-filters").addEventListener("click", applyFiltersAndRender);
  document.getElementById("btn-reset-filters").addEventListener("click", resetFilters);

  // Collapse/Expand all
  document.getElementById("btn-collapse-all").addEventListener("click", () => toggleAllCards(false));
  document.getElementById("btn-expand-all").addEventListener("click", () => toggleAllCards(true));
}

function resetFilters() {
  // Reset checkboxes
  document.getElementById("filter-correct").checked = true;
  document.getElementById("filter-almost").checked = true;
  document.getElementById("filter-incorrect").checked = true;
  document.getElementById("filter-confident").checked = true;
  document.getElementById("filter-unconfident").checked = true;
  document.getElementById("filter-majority-wrong-final-correct").checked = true;

  // Reset thresholds to defaults
  document.getElementById("offset-threshold-almost").value = "1";
  document.getElementById("offset-threshold-verywrong").value = "3";
  document.getElementById("conf-threshold-high").value = "0.75";
  document.getElementById("conf-threshold-low").value = "0.25";

  offsetThresholdAlmost = 1;
  offsetThresholdVeryWrong = 3;
  highConfidenceThreshold = 0.75;
  lowConfidenceThreshold = 0.25;

  // Clear sample index
  document.getElementById("filter-sample-index").value = "";

  applyFiltersAndRender();
}

// ------------------------------------------------------------------------------------------
// Filtering Logic
// ------------------------------------------------------------------------------------------
function applyFiltersAndRender() {
  const correctCb = document.getElementById("filter-correct");
  const almostCb = document.getElementById("filter-almost");
  const wrongCb = document.getElementById("filter-incorrect");
  const highConfCb = document.getElementById("filter-confident");
  const lowConfCb = document.getElementById("filter-unconfident");
  const turnaroundCb = document.getElementById("filter-majority-wrong-final-correct");
  const sampleIndexInput = document.getElementById("filter-sample-index").value.trim();

  // Parse sample index filter
  let sampleIndexFilter = null;
  if (sampleIndexInput) {
    sampleIndexFilter = sampleIndexInput.split(",").map(s => parseInt(s.trim(), 10));
    sampleIndexFilter = sampleIndexFilter.filter(n => !isNaN(n));
  }

  const filtered = allSamples.filter(sample => {
    const final = sample.final_metrics || {};
    const offset = final.offset_from_correct;
    const conf = final.confidence || 0;
    const correct = (offset === 0);
    const almost = !correct && offset <= offsetThresholdAlmost;
    const veryWrong = offset >= offsetThresholdVeryWrong;
    const highConf = conf >= highConfidenceThreshold;
    const lowConf = conf <= lowConfidenceThreshold;

    // Turnaround logic
    const windows = sample.window_metrics || [];
    const nW = windows.length;
    const nCorrect = windows.filter(w => w.correct === true).length;
    const majorityWrong = (nCorrect < nW / 2);
    const isTurnaround = (majorityWrong && correct);

    // If sampleIndexFilter is used, check membership
    if (sampleIndexFilter && sampleIndexFilter.length > 0) {
      if (!sampleIndexFilter.includes(sample.sample_idx)) {
        return false;
      }
    }

    // Check checkboxes
    if (!correctCb.checked && correct) return false;
    if (!almostCb.checked && almost) return false;
    if (!wrongCb.checked && veryWrong) return false;
    if (!highConfCb.checked && highConf) return false;
    if (!lowConfCb.checked && lowConf) return false;
    if (!turnaroundCb.checked && isTurnaround) return false;

    return true;
  });

  renderSamples(filtered);
  renderGlobalStats(filtered);
}

// ------------------------------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------------------------------
function renderSamples(samples) {
  const container = document.getElementById("sample-container");
  container.innerHTML = "";

  if (!samples.length) {
    container.innerHTML = `<div class="alert alert-warning">No samples match the filters.</div>`;
    return;
  }

  samples.forEach(sample => {
    container.appendChild(createSampleCard(sample));
  });
}

/**
 * Creates one "card" for a sample. 
 */
function createSampleCard(sample) {
  const card = document.createElement("div");
  card.className = "card mb-4 shadow-sm border rounded sample-card";

  // Card header
  const header = document.createElement("div");
  header.className = "card-header d-flex justify-content-between align-items-center";
  header.style.cursor = "pointer";

  const title = document.createElement("h5");
  title.textContent = `Sample #${sample.sample_idx}`;
  header.appendChild(title);

  const icon = document.createElement("span");
  icon.textContent = "▼";
  icon.className = "collapse-icon";
  header.appendChild(icon);

  // Collapsible body
  const body = document.createElement("div");
  body.className = "card-body collapse-body";
  body.style.display = "block"; // start expanded

  // Content
  body.appendChild(createFinalMetricsSection(sample));
  body.appendChild(createFullMediaSection(sample));
  body.appendChild(createWindowTableSection(sample));

  // Toggle logic
  header.addEventListener("click", () => {
    if (body.style.display === "none") {
      body.style.display = "block";
      icon.textContent = "▼";
    } else {
      body.style.display = "none";
      icon.textContent = "▲";
    }
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

/**
 * Final Metrics, including color-coding for correctness, offset, and confidence.
 */
function createFinalMetricsSection(sample) {
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const conf = final.confidence;
  const isCorrect = (offset === 0);

  const container = document.createElement("div");
  container.className = "mb-3";

  const title = document.createElement("h6");
  title.textContent = "Final Metrics";
  title.className = "mb-2";
  container.appendChild(title);

  // We'll build a row with text & color-coded badges
  const row = document.createElement("div");
  row.className = "row g-2 align-items-center";

  // Ground truth & predicted class
  const colLeft = document.createElement("div");
  colLeft.className = "col-auto";
  colLeft.innerHTML = `
    <div><strong>Ground Truth:</strong> ${final.ground_truth ?? "N/A"}</div>
    <div><strong>Predicted:</strong> ${final.predicted_class ?? "N/A"}</div>
  `;
  row.appendChild(colLeft);

  // Correctness badge
  const correctnessBadge = document.createElement("span");
  correctnessBadge.className = isCorrect ? "badge bg-success me-2" : "badge bg-danger me-2";
  correctnessBadge.textContent = isCorrect ? "Correct" : "Incorrect";

  // Offset badge
  const offsetBadge = document.createElement("span");
  offsetBadge.className = "badge me-2 " + getOffsetColorClass(offset);
  offsetBadge.textContent = 
    offset === undefined || offset === null ? "Offset: N/A" : `Offset: ${offset}`;

  // Confidence badge
  const confBadge = document.createElement("span");
  const confText = (conf !== undefined) ? conf.toFixed(3) : "N/A";
  confBadge.className = "badge " + getConfidenceColorClass(conf);
  confBadge.textContent = `Conf: ${confText}`;

  const colRight = document.createElement("div");
  colRight.className = "col-auto";
  colRight.appendChild(correctnessBadge);
  colRight.appendChild(offsetBadge);
  colRight.appendChild(confBadge);

  row.appendChild(colRight);
  container.appendChild(row);

  // Window-level stats
  const { offset: offStats, confidence: confStats } = sample.stats;
  const statsDiv = document.createElement("div");
  statsDiv.className = "mt-3";

  statsDiv.innerHTML = `
    <strong>Window Stats (Offset):</strong> 
      min=${fmtStat(offStats.min)} / 
      max=${fmtStat(offStats.max)} / 
      mean=${fmtStat(offStats.mean)} / 
      std=${fmtStat(offStats.std)} <br/>
    <strong>Window Stats (Confidence):</strong> 
      min=${fmtStat(confStats.min, 3)} / 
      max=${fmtStat(confStats.max, 3)} / 
      mean=${fmtStat(confStats.mean, 3)} / 
      std=${fmtStat(confStats.std, 3)}
  `;
  container.appendChild(statsDiv);

  return container;
}

/** Returns a Bootstrap badge color class for offset. */
function getOffsetColorClass(offset) {
  if (offset === undefined || offset === null) return "bg-secondary";
  if (offset === 0) return "bg-success";
  if (offset <= offsetThresholdAlmost) return "bg-warning text-dark"; 
  if (offset >= offsetThresholdVeryWrong) return "bg-danger";
  return "bg-secondary";
}

/** Returns a Bootstrap badge color class for confidence. */
function getConfidenceColorClass(conf) {
  if (conf === undefined || conf === null) return "bg-secondary";
  if (conf >= highConfidenceThreshold) return "bg-success";
  if (conf <= lowConfidenceThreshold) return "bg-danger";
  return "bg-warning text-dark";
}

/** Format a stat with optional decimal places. */
function fmtStat(value, decimals = 2) {
  if (value === null) return "N/A";
  return value.toFixed(decimals);
}

/**
 * Full Audio/Video Section 
 * We derive the folder path from the first window's video_path if it exists,
 * otherwise we default to: "data/sample_{sample_idx}"
 * Then we build "full_window.mp4" and "melspectrogram_full.png" 
 * and show them if they load. Otherwise, "No data".
 */
function createFullMediaSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";

  const title = document.createElement("h6");
  title.textContent = "Full Audio/Video";
  container.appendChild(title);

  // Attempt to derive folder path from any window path
  const w = sample.window_metrics || [];
  let folderPath = null;
  if (w.length > 0 && w[0].video_path) {
    // e.g. "data/sample_10/window_0.mp4"
    const p = w[0].video_path; 
    const match = p.match(/^(.*\/sample_\d+)\/.*$/);
    if (match) {
      folderPath = match[1]; // e.g. "data/sample_10"
    }
  }

  // If we still don't have folderPath, just use default: "data/sample_{idx}"
  if (!folderPath) {
    folderPath = `data/sample_${sample.sample_idx}`;
  }

  // Build the two file paths
  const fullVidPath = `${folderPath}/full_window.mp4`;
  const fullMelspecPath = `${folderPath}/melspectrogram_full.png`;

  // We'll try to embed them. If they fail to load => onerror hides them.
  let hasAtLeastOne = false;

  const video = document.createElement("video");
  video.src = fullVidPath;
  video.controls = true;
  video.width = 400;
  video.className = "d-block mb-2";
  video.onerror = () => { video.remove(); checkIfEmpty(); };
  container.appendChild(video);
  hasAtLeastOne = true;

  const img = document.createElement("img");
  img.src = fullMelspecPath;
  img.alt = "Full Melspectrogram";
  img.width = 600;  // Make it larger
  img.onerror = () => { img.remove(); checkIfEmpty(); };
  container.appendChild(img);
  hasAtLeastOne = true;

  // If both fail, show "No data".
  function checkIfEmpty() {
    if (!video.isConnected && !img.isConnected) {
      container.innerHTML += `<div class="text-muted mt-2">No full audio/video data found.</div>`;
    }
  }

  return container;
}

/**
 * Window Breakdown (table)
 */
function createWindowTableSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";

  const title = document.createElement("h6");
  title.textContent = "Window Breakdown";
  container.appendChild(title);

  const windows = sample.window_metrics || [];
  if (!windows.length) {
    container.innerHTML += `<div class="text-muted">No window metrics.</div>`;
    return container;
  }

  const table = document.createElement("table");
  table.className = "table table-striped table-bordered table-sm align-middle";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr class="table-secondary">
      <th>Iter</th>
      <th>Pred Class</th>
      <th>GT</th>
      <th>Conf</th>
      <th>Offset</th>
      <th>Correct?</th>
      <th>Video</th>
      <th>Melspec</th>
    </tr>
  `;

  const tbody = document.createElement("tbody");

  windows.forEach(w => {
    const row = document.createElement("tr");
    const isCorrect = w.correct ? "Yes" : "No";

    // Confidence with color-coded badge
    const confBadgeHtml = `
      <span class="badge ${getConfidenceColorClass(w.confidence)}">
        ${w.confidence !== undefined ? w.confidence.toFixed(3) : "N/A"}
      </span>
    `;

    // Offset with color-coded badge
    const offsetBadgeHtml = `
      <span class="badge ${getOffsetColorClass(w.offset_from_correct)}">
        ${w.offset_from_correct ?? "N/A"}
      </span>
    `;

    row.innerHTML = `
      <td>${w.iteration ?? ""}</td>
      <td>${w.predicted_class ?? ""}</td>
      <td>${w.ground_truth ?? ""}</td>
      <td>${confBadgeHtml}</td>
      <td>${offsetBadgeHtml}</td>
      <td>${isCorrect}</td>
      <td>${
        w.video_path 
          ? `<video src="${w.video_path}" controls width="150" onerror="this.onerror=null;this.src='';this.parentNode.textContent='No data';"></video>` 
          : "N/A"
      }</td>
      <td>${
        w.melspectrogram_path
          ? `<img src="${w.melspectrogram_path}" width="150" alt="Melspec" onerror="this.onerror=null;this.src='';this.parentNode.textContent='No data';">`
          : "N/A"
      }</td>
    `;
    tbody.appendChild(row);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
  return container;
}

// ------------------------------------------------------------------------------------------
// Collapse/Expand all
// ------------------------------------------------------------------------------------------
function toggleAllCards(expand) {
  const cardBodies = document.querySelectorAll(".collapse-body");
  const icons = document.querySelectorAll(".collapse-icon");

  cardBodies.forEach((body, i) => {
    if (expand) {
      body.style.display = "block";
      if (icons[i]) icons[i].textContent = "▼";
    } else {
      body.style.display = "none";
      if (icons[i]) icons[i].textContent = "▲";
    }
  });
}

// ------------------------------------------------------------------------------------------
// Global Stats
// ------------------------------------------------------------------------------------------
function renderGlobalStats(samples) {
  const statsEl = document.getElementById("global-stats");
  if (!samples.length) {
    statsEl.innerHTML = "No samples available with current filters.";
    return;
  }

  let countCorrect = 0;
  let sumConf = 0;
  let sumOffset = 0;
  let validOffsetCount = 0;

  samples.forEach(s => {
    const final = s.final_metrics || {};
    const offset = final.offset_from_correct;
    const conf = final.confidence;
    if (offset === 0) countCorrect++;
    if (typeof offset === "number") {
      sumOffset += offset;
      validOffsetCount++;
    }
    if (typeof conf === "number") {
      sumConf += conf;
    }
  });

  const n = samples.length;
  const accuracy = (countCorrect / n) * 100;
  const avgConf = sumConf / n;
  const avgOffset = validOffsetCount > 0 ? sumOffset / validOffsetCount : NaN;

  statsEl.innerHTML = `
    <strong>Total Samples:</strong> ${n}<br/>
    <strong>Accuracy (final predictions):</strong> ${accuracy.toFixed(1)}%<br/>
    <strong>Average Final Confidence:</strong> ${isNaN(avgConf) ? "N/A" : avgConf.toFixed(3)}<br/>
    <strong>Average Offset (among valid offsets):</strong> ${isNaN(avgOffset) ? "N/A" : avgOffset.toFixed(2)}
  `;
}
