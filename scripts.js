"use strict";

// Global threshold variables (shared across all dataset viewers)
let offsetThresholdAlmost = 2;
let offsetThresholdVeryWrong = 3;
let highConfidenceThreshold = 0.7;
let lowConfidenceThreshold = 0.2;

// Array to hold dataset viewer objects for each dataset (21-class and binary)
let datasetViewers = [];

/* 
Each dataset viewer object has the following structure:
{
   label: string,
   jsonPath: string,
   section: DOM element (the section containing the viewer),
   container: DOM element (where sample cards are appended),
   globalStatsEl: DOM element (for the viewer’s stats),
   samples: array,
   sampleCards: object mapping sample_idx to card element
}
*/

document.addEventListener("DOMContentLoaded", () => {
  // Initialize dataset viewers
  const viewer21 = {
    label: "21-Class Predictions",
    jsonPath: "data/samples.json",
    section: document.getElementById("section-21"),
    container: document.getElementById("sample-container-21"),
    globalStatsEl: document.getElementById("global-stats-21"),
    samples: [],
    sampleCards: {}
  };

  const viewerOOS = {
    label: "Binary Predictions (In Sync/Out of Sync)",
    jsonPath: "data_oos/samples.json",
    section: document.getElementById("section-oos"),
    container: document.getElementById("sample-container-oos"),
    globalStatsEl: document.getElementById("global-stats-oos"),
    samples: [],
    sampleCards: {}
  };

  // Add viewers to global array
  datasetViewers.push(viewer21, viewerOOS);

  // Load each dataset
  datasetViewers.forEach(viewer => {
    loadDatasetViewer(viewer);
  });

  // Setup global UI event listeners
  setupUI();
});

// Load a dataset viewer from its JSON file
function loadDatasetViewer(viewer) {
  fetch(viewer.jsonPath)
    .then(res => {
      if (!res.ok) throw new Error("Network response was not ok");
      return res.json();
    })
    .then(data => {
      viewer.samples = data;
      viewer.samples.forEach(computeSampleStats);
      createAllSampleCards(viewer);
      updateCardColorsForViewer(viewer);
      applyFiltersToViewer(viewer);
      renderGlobalStatsForViewer(viewer);
    })
    .catch(err => {
      console.error("Error loading", viewer.jsonPath, err);
      // Hide the section if data cannot be loaded
      viewer.section.style.display = "none";
    });
}

// -----------------------------------------------------
// Stats computation (same as before)
// -----------------------------------------------------
function computeSampleStats(sample) {
  const w = sample.window_metrics || [];
  const offsets = [];
  const confs = [];
  w.forEach(win => {
    if (typeof win.offset_from_correct === "number") offsets.push(win.offset_from_correct);
    if (typeof win.confidence === "number") confs.push(win.confidence);
  });
  sample.stats = { offset: getStats(offsets), confidence: getStats(confs) };
}

function getStats(values) {
  if (!values.length) return { min: null, max: null, mean: null, std: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
  return { min, max, mean, std: Math.sqrt(variance) };
}

// -----------------------------------------------------
// Build all sample cards for a given viewer
// -----------------------------------------------------
function createAllSampleCards(viewer) {
  viewer.container.innerHTML = "";
  viewer.samples.forEach(sample => {
    const card = createSampleCard(sample);
    viewer.sampleCards[sample.sample_idx] = card;
    viewer.container.appendChild(card);
  });
}

/**
 * Create a single sample card (collapsed by default).
 * Lazy-loads videos & images when the card is expanded.
 */
function createSampleCard(sample) {
  const card = document.createElement("div");
  card.className = "card mb-4 shadow-sm sample-card";

  // Header
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

  // Body (collapsed by default)
  const body = document.createElement("div");
  body.className = "card-body collapse-body";
  body.style.display = "none";

  // Append sections: final metrics, full media, and window breakdown
  body.appendChild(createFinalMetricsSection(sample));
  body.appendChild(createFullMediaSection(sample));
  body.appendChild(createWindowTableSection(sample));

  // Mark that videos/images haven’t been lazy-loaded yet
  card.dataset.videosLoaded = "false";

  // Toggle expand/collapse on header click
  header.addEventListener("click", () => {
    const isCollapsed = (body.style.display === "none");
    if (isCollapsed) {
      body.style.display = "block";
      icon.textContent = "▼";
      if (card.dataset.videosLoaded === "false") {
        lazyLoadMedia(card);
        card.dataset.videosLoaded = "true";
      }
    } else {
      body.style.display = "none";
      icon.textContent = "▲";
    }
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// -----------------------------------------------------
// Lazy-load videos & images when the user expands a card
// -----------------------------------------------------
function lazyLoadMedia(card) {
  const videos = card.querySelectorAll("video[data-video-url]");
  videos.forEach(v => (v.src = v.dataset.videoUrl));
  const imgs = card.querySelectorAll("img[data-img-url]");
  imgs.forEach(img => (img.src = img.dataset.imgUrl));
}

/**
 * Creates the final metrics section including a bar chart for softmax_probs and cross entropy.
 */
function createFinalMetricsSection(sample) {
  const final = sample.final_metrics || {};
  const container = document.createElement("div");
  container.className = "mb-3";
  container.innerHTML = `
    <h6 class="mb-2 fw-bold">Final Metrics</h6>
    <div class="row g-2">
      <div class="col-sm-6" data-final-left></div>
      <div class="col-sm-6" data-final-right></div>
    </div>
    <div class="mt-2" data-bar-chart></div>
  `;
  const ceEl = document.createElement("div");
  ceEl.className = "mt-2";
  ceEl.innerHTML = `
    <strong>Cross Entropy:</strong> ${final.cross_entropy ?? "N/A"}<br/>
    <strong>Rank of Correct Class:</strong> ${final.rank_of_correct_class ?? "N/A"}
  `;
  container.appendChild(ceEl);
  const statsDiv = document.createElement("div");
  statsDiv.className = "mt-2 border-top pt-2";
  statsDiv.dataset.finalStats = "";
  container.appendChild(statsDiv);
  return container;
}

/**
 * Creates the full audio/video section.
 * (Videos and images are lazy-loaded.)
 */
function createFullMediaSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";
  const title = document.createElement("h6");
  title.textContent = "Full Audio/Video";
  title.className = "fw-bold mb-2";
  container.appendChild(title);
  let folderPath = `data/sample_${sample.sample_idx}`;
  const w = sample.window_metrics || [];
  if (w.length && w[0].video_path) {
    const m = w[0].video_path.match(/^(.*sample_\d+)\/.*$/);
    if (m) folderPath = m[1];
  }
  const fullVidPath = `${folderPath}/full_window.mp4`;
  const fullMelspecPath = `${folderPath}/melspectrogram_full.png`;
  const vid = document.createElement("video");
  vid.width = 400;
  vid.controls = true;
  vid.className = "mb-2 d-block";
  vid.dataset.videoUrl = fullVidPath;
  vid.onerror = () => { vid.replaceWith(document.createTextNode("No full video found.")); };
  container.appendChild(vid);
  const img = document.createElement("img");
  img.width = 600;
  img.alt = "Full Melspectrogram";
  img.dataset.imgUrl = fullMelspecPath;
  img.onerror = () => { img.replaceWith(document.createTextNode("No full spectrogram found.")); };
  container.appendChild(img);
  return container;
}

/**
 * Creates the window breakdown table.
 */
function createWindowTableSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";
  const title = document.createElement("h6");
  title.textContent = "Window Breakdown";
  title.className = "fw-bold mb-2";
  container.appendChild(title);
  const windows = sample.window_metrics || [];
  if (!windows.length) {
    container.innerHTML += `<div class="text-muted">No window metrics.</div>`;
    return container;
  }
  const table = document.createElement("table");
  table.className = "table table-striped table-bordered table-hover align-middle";
  table.style.backgroundColor = "#fff";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr class="table-secondary">
      <th>Iter</th>
      <th>Pred Class</th>
      <th>GT</th>
      <th>Confidence</th>
      <th>Offset</th>
      <th>Correct?</th>
      <th>Cross Entropy</th>
      <th>Bar Chart</th>
      <th>Video</th>
      <th>Melspec</th>
    </tr>
  `;
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  windows.forEach(w => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${w.iteration ?? ""}</td>
      <td>${w.predicted_class ?? ""}</td>
      <td>${w.ground_truth ?? ""}</td>
      <td data-conf></td>
      <td data-offset></td>
      <td>${w.correct ? `<span class="badge bg-success">Yes</span>` : `<span class="badge bg-danger">No</span>`}</td>
      <td>${w.cross_entropy ?? "N/A"}</td>
      <td data-bar></td>
      <td data-video></td>
      <td data-melspec></td>
    `;
    row.querySelector("[data-conf]").dataset.confValue = w.confidence ?? "null";
    row.querySelector("[data-offset]").dataset.offsetValue = w.offset_from_correct ?? "null";
    const barTd = row.querySelector("[data-bar]");
    if (w.softmax_probs) {
      const chartDiv = createSoftmaxBarChart(w.softmax_probs, w.ground_truth, w.predicted_class);
      barTd.appendChild(chartDiv);
    } else {
      barTd.textContent = "N/A";
    }
    const videoTd = row.querySelector("[data-video]");
    if (w.video_path) {
      const vid = document.createElement("video");
      vid.width = 150;
      vid.controls = true;
      vid.dataset.videoUrl = w.video_path;
      vid.onerror = () => { vid.replaceWith(document.createTextNode("No data")); };
      videoTd.appendChild(vid);
    } else {
      videoTd.textContent = "N/A";
    }
    const melspecTd = row.querySelector("[data-melspec]");
    if (w.melspectrogram_path) {
      const img = document.createElement("img");
      img.width = 150;
      img.alt = "Melspec";
      img.dataset.imgUrl = w.melspectrogram_path;
      img.onerror = () => { img.replaceWith(document.createTextNode("No data")); };
      melspecTd.appendChild(img);
    } else {
      melspecTd.textContent = "N/A";
    }
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);
  return container;
}

/**
 * Creates a small bar chart of the softmax probabilities.
 */
function createSoftmaxBarChart(probs, groundTruth, predictedClass) {
  let maxVal = -Infinity, maxIdx = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > maxVal) {
      maxVal = probs[i];
      maxIdx = i;
    }
  }
  const container = document.createElement("div");
  container.className = "d-flex flex-row align-items-end flex-wrap";
  container.style.maxWidth = "250px";
  container.style.gap = "2px";
  for (let i = 0; i < probs.length; i++) {
    const bar = document.createElement("div");
    const p = probs[i];
    const scaledWidth = Math.round(p * 100);
    let bgColor = "#ccc";
    if (i === maxIdx && i === groundTruth) {
      bgColor = "green";
    } else if (i === maxIdx) {
      bgColor = "red";
    } else if (i === groundTruth) {
      bgColor = "gold";
    }
    bar.style.backgroundColor = bgColor;
    bar.style.height = "12px";
    bar.style.width = scaledWidth + "%";
    bar.style.flex = "0 0 auto";
    bar.title = `Class ${i}: ${(p * 100).toFixed(1)}%`;
    container.appendChild(bar);
  }
  return container;
}

// -----------------------------------------------------
// Global UI functions (controls affect all viewers)
// -----------------------------------------------------
function setupUI() {
  // Threshold change events
  document.getElementById("offset-threshold-almost").addEventListener("change", e => {
    offsetThresholdAlmost = parseFloat(e.target.value) || 2;
    datasetViewers.forEach(viewer => updateCardColorsForViewer(viewer));
  });
  document.getElementById("offset-threshold-verywrong").addEventListener("change", e => {
    offsetThresholdVeryWrong = parseFloat(e.target.value) || 3;
    datasetViewers.forEach(viewer => updateCardColorsForViewer(viewer));
  });
  document.getElementById("conf-threshold-high").addEventListener("change", e => {
    highConfidenceThreshold = parseFloat(e.target.value) || 0.7;
    datasetViewers.forEach(viewer => updateCardColorsForViewer(viewer));
  });
  document.getElementById("conf-threshold-low").addEventListener("change", e => {
    lowConfidenceThreshold = parseFloat(e.target.value) || 0.2;
    datasetViewers.forEach(viewer => updateCardColorsForViewer(viewer));
  });

  // Filter controls – update filters and stats for each viewer
  [
    "filter-turnaround", "filter-lowConf", "filter-midConf", "filter-highConf",
    "filter-hasVideo", "filter-correct", "filter-almost", "filter-incorrect",
    "filter-use-iteration", "filter-iteration", "filter-sample-index"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      datasetViewers.forEach(viewer => {
        applyFiltersToViewer(viewer);
        renderGlobalStatsForViewer(viewer);
      });
    });
  });
  document.getElementById("btn-apply-filters").addEventListener("click", () => {
    datasetViewers.forEach(viewer => {
      applyFiltersToViewer(viewer);
      renderGlobalStatsForViewer(viewer);
    });
  });
  document.getElementById("btn-reset-filters").addEventListener("click", resetFilters);

  // Collapse / Expand All buttons
  document.getElementById("btn-collapse-all").addEventListener("click", () => toggleAllCards(false));
  document.getElementById("btn-expand-all").addEventListener("click", () => toggleAllCards(true));
}

function resetFilters() {
  document.getElementById("offset-threshold-almost").value = 2;
  document.getElementById("offset-threshold-verywrong").value = 3;
  document.getElementById("conf-threshold-high").value = 0.7;
  document.getElementById("conf-threshold-low").value = 0.2;
  offsetThresholdAlmost = 2;
  offsetThresholdVeryWrong = 3;
  highConfidenceThreshold = 0.7;
  lowConfidenceThreshold = 0.2;

  ["filter-turnaround", "filter-hasVideo", "filter-use-iteration"].forEach(id => {
    document.getElementById(id).checked = false;
  });
  ["filter-lowConf", "filter-midConf", "filter-highConf", "filter-correct", "filter-almost", "filter-incorrect"].forEach(id => {
    document.getElementById(id).checked = true;
  });
  document.getElementById("filter-iteration").value = "";
  document.getElementById("filter-sample-index").value = "";

  datasetViewers.forEach(viewer => {
    updateCardColorsForViewer(viewer);
    applyFiltersToViewer(viewer);
    renderGlobalStatsForViewer(viewer);
  });
}

function toggleAllCards(expand) {
  datasetViewers.forEach(viewer => {
    Object.values(viewer.sampleCards).forEach(cardEl => {
      const body = cardEl.querySelector(".collapse-body");
      const icon = cardEl.querySelector(".collapse-icon");
      if (!body) return;
      if (expand) {
        body.style.display = "block";
        if (icon) icon.textContent = "▼";
        if (cardEl.dataset.videosLoaded === "false") {
          lazyLoadMedia(cardEl);
          cardEl.dataset.videosLoaded = "true";
        }
      } else {
        body.style.display = "none";
        if (icon) icon.textContent = "▲";
      }
    });
  });
}

// -----------------------------------------------------
// Filtering functions for a viewer
// -----------------------------------------------------
function applyFiltersToViewer(viewer) {
  const onlyTurnaround = document.getElementById("filter-turnaround").checked;
  const showLow = document.getElementById("filter-lowConf").checked;
  const showMid = document.getElementById("filter-midConf").checked;
  const showHigh = document.getElementById("filter-highConf").checked;
  const onlyHasVideo = document.getElementById("filter-hasVideo").checked;
  const showCorrect = document.getElementById("filter-correct").checked;
  const showAlmost = document.getElementById("filter-almost").checked;
  const showVeryWrong = document.getElementById("filter-incorrect").checked;
  const sampleIndexInput = document.getElementById("filter-sample-index").value.trim();
  let sampleIndexFilter = null;
  if (sampleIndexInput) {
    sampleIndexFilter = sampleIndexInput.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }
  viewer.samples.forEach(s => {
    const pass = doesSamplePassFilter(
      s,
      onlyTurnaround, showLow, showMid, showHigh, onlyHasVideo,
      showCorrect, showAlmost, showVeryWrong,
      sampleIndexFilter
    );
    if (viewer.sampleCards[s.sample_idx]) {
      viewer.sampleCards[s.sample_idx].style.display = pass ? "block" : "none";
    }
  });
}

function doesSamplePassFilter(
  sample,
  onlyTurnaround, showLow, showMid, showHigh, onlyHasVideo,
  showCorrect, showAlmost, showVeryWrong,
  sampleIndexFilter
) {
  let offset, conf;
  const useIteration = document.getElementById("filter-use-iteration").checked;
  if (useIteration) {
    const iterInput = document.getElementById("filter-iteration").value.trim();
    const iterNum = parseInt(iterInput, 10);
    if (!isNaN(iterNum)) {
      const windowMetric = (sample.window_metrics || []).find(w => w.iteration === iterNum);
      if (windowMetric) {
        offset = windowMetric.offset_from_correct;
        conf = windowMetric.confidence;
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else {
    const fin = sample.final_metrics || {};
    offset = fin.offset_from_correct;
    conf = fin.confidence ?? 0;
  }

  if (onlyTurnaround) {
    const w = sample.window_metrics || [];
    const nW = w.length;
    const nCorrect = w.filter(x => x.correct).length;
    const majorityWrong = (nCorrect < nW / 2);
    const finalCorrect = (offset === 0);
    const isTurnaround = (majorityWrong && finalCorrect);
    if (!isTurnaround) return false;
  }

  const confCat = getConfidenceCategory(conf);
  if (confCat === "low" && !showLow) return false;
  if (confCat === "mid" && !showMid) return false;
  if (confCat === "high" && !showHigh) return false;

  const offCat = getOffsetCategory(offset);
  if (offCat === "correct" && !showCorrect) return false;
  if (offCat === "almost" && !showAlmost) return false;
  if (offCat === "veryWrong" && !showVeryWrong) return false;

  if (onlyHasVideo) {
    const hasAnyVideo = (sample.window_metrics || []).some(w => w.video_path);
    if (!hasAnyVideo) return false;
  }

  if (sampleIndexFilter && sampleIndexFilter.length > 0) {
    if (!sampleIndexFilter.includes(sample.sample_idx)) return false;
  }

  return true;
}

// -----------------------------------------------------
// Confidence / Offset categories
// -----------------------------------------------------
function getConfidenceCategory(conf) {
  if (conf >= highConfidenceThreshold) return "high";
  if (conf <= lowConfidenceThreshold) return "low";
  return "mid";
}
function getOffsetCategory(offset) {
  if (offset === 0) return "correct";
  if (offset !== undefined && offset <= offsetThresholdAlmost) return "almost";
  if (offset !== undefined && offset >= offsetThresholdVeryWrong) return "veryWrong";
  return "other";
}
function fmtStat(val, decimals = 2) {
  if (val === null || isNaN(val)) return "N/A";
  return val.toFixed(decimals);
}

// -----------------------------------------------------
// Update card colors for a viewer
// -----------------------------------------------------
function updateCardColorsForViewer(viewer) {
  viewer.samples.forEach(s => {
    const cardEl = viewer.sampleCards[s.sample_idx];
    if (cardEl) updateCardColors(s, cardEl);
  });
}

// Update a single card’s color settings
function updateCardColors(sample, cardEl) {
  const final = sample.final_metrics || {};
  let offset, conf;
  const useIteration = document.getElementById("filter-use-iteration").checked;
  if (useIteration) {
    const iterInput = document.getElementById("filter-iteration").value.trim();
    const iterNum = parseInt(iterInput, 10);
    const windowMetric = (sample.window_metrics || []).find(w => w.iteration === iterNum);
    if (windowMetric) {
      offset = windowMetric.offset_from_correct;
      conf = windowMetric.confidence;
    } else {
      offset = final.offset_from_correct;
      conf = final.confidence;
    }
  } else {
    offset = final.offset_from_correct;
    conf = final.confidence;
  }
  const leftDiv = cardEl.querySelector("[data-final-left]");
  const rightDiv = cardEl.querySelector("[data-final-right]");
  const statsDiv = cardEl.querySelector("[data-final-stats]");
  if (leftDiv && rightDiv && statsDiv) {
    leftDiv.innerHTML = `
      <div><strong>Ground Truth:</strong> ${final.ground_truth ?? "N/A"}</div>
      <div><strong>Predicted:</strong> ${final.predicted_class ?? "N/A"}</div>
    `;
    const isCorrect = (offset === 0);
    const correctBadge = `<span class="badge ${isCorrect ? "bg-success" : "bg-danger"}">
      ${isCorrect ? "Yes" : "No"}
    </span>`;
    const offBadge = `<span class="badge ${getOffsetColorClass(offset)}">
      ${offset ?? "N/A"}
    </span>`;
    const confBadge = `<span class="badge ${getConfidenceColorClass(conf)}">
      ${conf !== undefined && conf !== null ? conf.toFixed(3) : "N/A"}
    </span>`;
    rightDiv.innerHTML = `
      <div><strong>Correct?</strong> ${correctBadge}</div>
      <div><strong>Offset:</strong> ${offBadge}</div>
      <div><strong>Confidence:</strong> ${confBadge}</div>
    `;

    const { offset: offStats, confidence: confStats } = sample.stats;
    statsDiv.innerHTML = `
      <strong>Window Stats (Offset):</strong>
        min=${fmtStat(offStats.min)} /
        max=${fmtStat(offStats.max)} /
        mean=${fmtStat(offStats.mean)} /
        std=${fmtStat(offStats.std)}<br/>
      <strong>Window Stats (Confidence):</strong>
        min=${fmtStat(confStats.min, 3)} /
        max=${fmtStat(confStats.max, 3)} /
        mean=${fmtStat(confStats.mean, 3)} /
        std=${fmtStat(confStats.std, 3)}
    `;
  }
  const rows = cardEl.querySelectorAll("tr");
  rows.forEach(r => {
    const offTd = r.querySelector("[data-offset]");
    const confTd = r.querySelector("[data-conf]");
    if (offTd) {
      const val = offTd.dataset.offsetValue;
      if (val !== "null") {
        const num = parseFloat(val);
        offTd.innerHTML = `<span class="badge ${getOffsetColorClass(num)}">${num}</span>`;
      } else {
        offTd.innerHTML = `<span class="badge bg-secondary">N/A</span>`;
      }
    }
    if (confTd) {
      const val = confTd.dataset.confValue;
      if (val !== "null") {
        const num = parseFloat(val);
        confTd.innerHTML = `<span class="badge ${getConfidenceColorClass(num)}">
          ${num.toFixed(3)}
        </span>`;
      } else {
        confTd.innerHTML = `<span class="badge bg-secondary">N/A</span>`;
      }
    }
  });
}

// -----------------------------------------------------
// Color classes for offset and confidence
// -----------------------------------------------------
function getOffsetColorClass(offset) {
  if (offset === 0) return "bg-success";
  if (offset !== undefined && offset <= offsetThresholdAlmost) return "bg-warning text-dark";
  if (offset !== undefined && offset >= offsetThresholdVeryWrong) return "bg-danger";
  return "bg-secondary";
}
function getConfidenceColorClass(conf) {
  if (conf === undefined || conf === null) return "bg-secondary";
  if (conf >= highConfidenceThreshold) return "bg-success";
  if (conf <= lowConfidenceThreshold) return "bg-danger";
  return "bg-warning text-dark";
}

// -----------------------------------------------------
// Render global stats for a viewer
// -----------------------------------------------------
function renderGlobalStatsForViewer(viewer) {
  const el = viewer.globalStatsEl;
  const filteredSamples = viewer.samples.filter(s => {
    const cardEl = viewer.sampleCards[s.sample_idx];
    return cardEl && cardEl.style.display !== "none";
  });
  if (!filteredSamples.length) {
    el.innerHTML = "No samples available with current filters.";
    return;
  }
  const useIteration = document.getElementById("filter-use-iteration").checked;
  let countCorrect = 0, sumConf = 0, sumOffset = 0, validOffs = 0;
  filteredSamples.forEach(s => {
    let off, c;
    if (useIteration) {
      const iterInput = document.getElementById("filter-iteration").value.trim();
      const iterNum = parseInt(iterInput, 10);
      const win = (s.window_metrics || []).find(w => w.iteration === iterNum);
      if (win) { off = win.offset_from_correct; c = win.confidence; }
    } else {
      const fin = s.final_metrics || {};
      off = fin.offset_from_correct;
      c = fin.confidence;
    }
    if (off === 0) countCorrect++;
    if (typeof off === "number") { sumOffset += off; validOffs++; }
    if (typeof c === "number") { sumConf += c; }
  });
  const n = filteredSamples.length;
  const accuracy = (countCorrect / n) * 100;
  const avgConf = sumConf / n;
  const avgOff = validOffs > 0 ? sumOffset / validOffs : NaN;
  el.innerHTML = `
    <strong>Total Samples:</strong> ${n}<br/>
    <strong>Accuracy (${useIteration ? "Iteration" : "Final"} predictions):</strong> ${accuracy.toFixed(1)}%<br/>
    <strong>Average ${useIteration ? "Iteration" : "Final"} Confidence:</strong> ${isNaN(avgConf) ? "N/A" : avgConf.toFixed(3)}<br/>
    <strong>Average ${useIteration ? "Iteration" : "Final"} Offset:</strong> ${isNaN(avgOff) ? "N/A" : avgOff.toFixed(2)}
  `;
}
