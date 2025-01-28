// scripts.js

// Default threshold values (will be updated from the HTML inputs)
let offsetThresholdAlmost = 1;
let offsetThresholdVeryWrong = 3;
let highConfidenceThreshold = 0.75;
let lowConfidenceThreshold = 0.25;

document.addEventListener("DOMContentLoaded", () => {
  // Load the JSON data
  fetch("data/samples.json")
    .then(resp => resp.json())
    .then(data => {
      // Precompute stats for each sample
      data.forEach(computeSampleStats);

      // Store globally
      window.allSamples = data;

      // Attach event handlers
      setupUI();

      // Initial render
      applyFiltersAndRender();
    })
    .catch(err => console.error("Failed to load data:", err));
});

// ---------------------------------------------------------
// Precompute stats (min/mean/max/std) for windows
// ---------------------------------------------------------
function computeSampleStats(sample) {
  const windows = sample.window_metrics || [];

  // Arrays to hold relevant numeric data
  const offsets = [];
  const confidences = [];

  windows.forEach(w => {
    if (typeof w.offset_from_correct === "number") {
      offsets.push(w.offset_from_correct);
    }
    if (typeof w.confidence === "number") {
      confidences.push(w.confidence);
    }
  });

  sample.stats = {
    offset: getStats(offsets),
    confidence: getStats(confidences),
    // You could compute other stats if you want (cross_entropy, etc.)
  };
}

/**
 * Returns { min, max, mean, std } for an array of numbers.
 */
function getStats(values) {
  if (!values.length) {
    return { min: null, max: null, mean: null, std: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { min, max, mean, std };
}

// ---------------------------------------------------------
// Setup UI listeners for filters, expansions, etc.
// ---------------------------------------------------------
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
  ["filter-correct", "filter-almost", "filter-incorrect", 
   "filter-confident", "filter-unconfident", "filter-majority-wrong-final-correct"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", applyFiltersAndRender);
  });

  // Sample index
  document.getElementById("btn-apply-filters").addEventListener("click", applyFiltersAndRender);
  document.getElementById("btn-reset-filters").addEventListener("click", resetFilters);

  // Collapse / Expand All
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

  // Clear sample index filter
  document.getElementById("filter-sample-index").value = "";

  applyFiltersAndRender();
}

// ---------------------------------------------------------
// Filter logic + Rendering
// ---------------------------------------------------------
function applyFiltersAndRender() {
  const correctCb = document.getElementById("filter-correct");
  const almostCb = document.getElementById("filter-almost");
  const wrongCb = document.getElementById("filter-incorrect");
  const highConfCb = document.getElementById("filter-confident");
  const lowConfCb = document.getElementById("filter-unconfident");
  const turnaroundCb = document.getElementById("filter-majority-wrong-final-correct");
  const sampleIndexInput = document.getElementById("filter-sample-index").value.trim();

  // Parse sample index input (comma-separated)
  let sampleIndexFilter = null;
  if (sampleIndexInput) {
    sampleIndexFilter = sampleIndexInput.split(",").map(s => parseInt(s.trim(), 10));
    sampleIndexFilter = sampleIndexFilter.filter(n => !isNaN(n));
  }

  const filtered = window.allSamples.filter(sample => {
    const final = sample.final_metrics || {};
    const offset = final.offset_from_correct;
    const conf = final.confidence || 0;
    const correct = (offset === 0);
    const almost = !correct && offset <= offsetThresholdAlmost;
    const veryWrong = offset >= offsetThresholdVeryWrong;
    const highConf = conf >= highConfidenceThreshold;
    const lowConf = conf <= lowConfidenceThreshold;

    // Check "turnaround" condition
    const windows = sample.window_metrics || [];
    const numWindows = windows.length;
    const numCorrect = windows.filter(x => x.correct === true).length;
    const majorityWrong = (numCorrect < numWindows / 2);
    const isTurnaround = (majorityWrong && correct);

    // If there's a sampleIndexFilter, check membership
    if (sampleIndexFilter && sampleIndexFilter.length > 0) {
      if (!sampleIndexFilter.includes(sample.sample_idx)) {
        return false;
      }
    }

    // Check each filter
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

/**
 * Renders the sample cards into #sample-container
 */
function renderSamples(samples) {
  const container = document.getElementById("sample-container");
  container.innerHTML = "";

  if (!samples.length) {
    container.innerHTML = `<div class="alert alert-warning">
      No samples match the current filters.
    </div>`;
    return;
  }

  samples.forEach(sample => {
    const card = createSampleCard(sample);
    container.appendChild(card);
  });
}

/**
 * Creates a Bootstrap card for a single sample
 */
function createSampleCard(sample) {
  const card = document.createElement("div");
  card.className = "card mb-4";

  // Card header with clickable toggle
  const header = document.createElement("div");
  header.className = "card-header d-flex justify-content-between align-items-center";
  header.style.cursor = "pointer";
  const title = document.createElement("h5");
  title.textContent = `Sample #${sample.sample_idx}`;
  header.appendChild(title);

  // Expand/Collapse icon
  const icon = document.createElement("span");
  icon.textContent = "▼";
  icon.className = "collapse-icon";
  header.appendChild(icon);

  // Collapsible body
  const body = document.createElement("div");
  body.className = "card-body collapse-body";

  // Final Metrics + Stats
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const conf = final.confidence;

  const correctnessText = (offset === 0) ? "Correct" : "Incorrect";

  // Basic final info
  const finalMetricsSection = document.createElement("div");
  finalMetricsSection.className = "mb-3";

  const finalTitle = document.createElement("h6");
  finalTitle.textContent = "Final Metrics";
  finalMetricsSection.appendChild(finalTitle);

  const finalInfo = document.createElement("p");
  finalInfo.innerHTML = `
    <strong>Ground Truth:</strong> ${final.ground_truth} <br/>
    <strong>Predicted Class:</strong> ${final.predicted_class} <br/>
    <strong>Correctness:</strong> ${correctnessText} <br/>
    <strong>Offset from Correct:</strong> ${offset !== undefined ? offset : "N/A"} <br/>
    <strong>Confidence:</strong> ${conf !== undefined ? conf.toFixed(3) : "N/A"} <br/>
  `;
  finalMetricsSection.appendChild(finalInfo);

  // Window-level stats (min, max, mean, std) from sample.stats
  const { offset: offStats, confidence: confStats } = sample.stats;
  const statsSection = document.createElement("p");
  statsSection.innerHTML = `
    <strong>Window Stats (Offset):</strong><br/>
    &nbsp; - min: ${offStats.min === null ? "N/A" : offStats.min.toFixed(2)} <br/>
    &nbsp; - max: ${offStats.max === null ? "N/A" : offStats.max.toFixed(2)} <br/>
    &nbsp; - mean: ${offStats.mean === null ? "N/A" : offStats.mean.toFixed(2)} <br/>
    &nbsp; - std: ${offStats.std === null ? "N/A" : offStats.std.toFixed(2)} <br/><br/>

    <strong>Window Stats (Confidence):</strong><br/>
    &nbsp; - min: ${confStats.min === null ? "N/A" : confStats.min.toFixed(3)} <br/>
    &nbsp; - max: ${confStats.max === null ? "N/A" : confStats.max.toFixed(3)} <br/>
    &nbsp; - mean: ${confStats.mean === null ? "N/A" : confStats.mean.toFixed(3)} <br/>
    &nbsp; - std: ${confStats.std === null ? "N/A" : confStats.std.toFixed(3)} <br/>
  `;
  finalMetricsSection.appendChild(statsSection);

  body.appendChild(finalMetricsSection);

  // Full A/V (if available)
  const fullAVSection = document.createElement("div");
  fullAVSection.className = "mb-3";
  const fullAVTitle = document.createElement("h6");
  fullAVTitle.textContent = "Full Audio/Video";
  fullAVSection.appendChild(fullAVTitle);

  // You might have stored these file paths in sample.metrics.json, e.g. "full_window.mp4"
  // We'll assume you can store them in the sample JSON under something like:
  // sample.full_av_path (for video) and sample.full_melspec_path (for spectrogram).
  // If they don’t exist, we skip.
  // Adjust these property names as needed.

  let hasAnyFullMedia = false;

  if (sample.full_av_path) {
    const video = document.createElement("video");
    video.src = sample.full_av_path;
    video.controls = true;
    video.width = 400;
    video.className = "mb-2 d-block";
    fullAVSection.appendChild(video);
    hasAnyFullMedia = true;
  }

  if (sample.full_melspec_path) {
    const img = document.createElement("img");
    img.src = sample.full_melspec_path;
    img.alt = "Full Melspectrogram";
    img.width = 400;
    fullAVSection.appendChild(img);
    hasAnyFullMedia = true;
  }

  if (!hasAnyFullMedia) {
    const noData = document.createElement("p");
    noData.textContent = "No full A/V data available.";
    fullAVSection.appendChild(noData);
  }

  body.appendChild(fullAVSection);

  // Window Table Section
  const windows = sample.window_metrics || [];
  const windowSection = document.createElement("div");
  windowSection.className = "mb-3";
  const windowTitle = document.createElement("h6");
  windowTitle.textContent = "Window Breakdown";
  windowSection.appendChild(windowTitle);

  const table = document.createElement("table");
  table.className = "table table-bordered table-sm align-middle";
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
    row.innerHTML = `
      <td>${w.iteration}</td>
      <td>${w.predicted_class}</td>
      <td>${w.ground_truth === undefined ? "" : w.ground_truth}</td>
      <td>${w.confidence !== undefined ? w.confidence.toFixed(3) : ""}</td>
      <td>${w.offset_from_correct !== undefined ? w.offset_from_correct : ""}</td>
      <td>${w.correct ? "Yes" : "No"}</td>
      <td>${
        w.video_path 
          ? `<video src="${w.video_path}" controls width="200"></video>` 
          : "N/A"
      }</td>
      <td>${
        w.melspectrogram_path 
          ? `<img src="${w.melspectrogram_path}" width="200" alt="Melspec">`
          : "N/A"
      }</td>
    `;
    tbody.appendChild(row);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  windowSection.appendChild(table);
  body.appendChild(windowSection);

  // Toggle logic
  header.addEventListener("click", () => {
    const currentlyHidden = body.style.display === "none";
    body.style.display = currentlyHidden ? "block" : "none";
    icon.textContent = currentlyHidden ? "▼" : "▲";
  });

  // By default, show expanded
  body.style.display = "block";
  icon.textContent = "▼";

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// ---------------------------------------------------------
// Collapse/Expand All
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// Global Stats
// ---------------------------------------------------------
function renderGlobalStats(samples) {
  const statsContainer = document.getElementById("global-stats");
  if (!samples.length) {
    statsContainer.innerHTML = "No samples available for stats.";
    return;
  }

  // Let’s compute some overall final metrics
  let countCorrect = 0;
  let sumConf = 0;
  let sumOffset = 0;
  let validOffsetCount = 0;

  samples.forEach(s => {
    const final = s.final_metrics || {};
    const offset = final.offset_from_correct;
    const conf = final.confidence;
    if (offset === 0) countCorrect += 1;
    if (typeof offset === "number") {
      sumOffset += offset;
      validOffsetCount += 1;
    }
    if (typeof conf === "number") {
      sumConf += conf;
    }
  });

  const n = samples.length;
  const avgConf = sumConf / n;
  const avgOffset = validOffsetCount > 0 ? (sumOffset / validOffsetCount) : NaN;
  const accuracy = (countCorrect / n) * 100;

  statsContainer.innerHTML = `
    <strong>Total Samples:</strong> ${n} <br/>
    <strong>Accuracy (final predictions):</strong> ${accuracy.toFixed(1)}% <br/>
    <strong>Average Final Confidence:</strong> ${isNaN(avgConf) ? "N/A" : avgConf.toFixed(3)} <br/>
    <strong>Average Offset from Correct:</strong> ${isNaN(avgOffset) ? "N/A" : avgOffset.toFixed(2)} <br/>
  `;
}
