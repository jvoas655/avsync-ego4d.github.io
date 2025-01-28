// -----------------------------------------------------
// Global threshold variables
// -----------------------------------------------------
let offsetThresholdAlmost = 1;
let offsetThresholdVeryWrong = 3;
let highConfidenceThreshold = 0.75;
let lowConfidenceThreshold = 0.25;

// We'll store sample data, plus a map from sample_idx -> card element
let allSamples = [];
let sampleCards = {};

document.addEventListener("DOMContentLoaded", () => {
  fetch("data/samples.json")
    .then(res => res.json())
    .then(data => {
      allSamples = data;
      allSamples.forEach(computeSampleStats);

      createAllSampleCards();
      setupUI();

      // Initial color update & filter application
      updateAllCardColors();
      applyFilters();
      renderGlobalStats(getFilteredSamples());
    })
    .catch(err => {
      console.error("Error loading samples.json:", err);
      document.getElementById("global-stats").textContent =
        "Could not load samples.json.";
    });
});

// -----------------------------------------------------
// Stats computation
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
  const mean = values.reduce((a,b) => a + b, 0) / values.length;
  const variance = values.reduce((acc,val) => acc + (val - mean)**2, 0) / values.length;
  return { min, max, mean, std: Math.sqrt(variance) };
}

// -----------------------------------------------------
// Build all sample cards (once)
// -----------------------------------------------------
function createAllSampleCards() {
  const container = document.getElementById("sample-container");
  container.innerHTML = "";

  allSamples.forEach(sample => {
    const card = createSampleCard(sample);
    sampleCards[sample.sample_idx] = card;
    container.appendChild(card);
  });
}

/**
 * Create a single sample card (collapsed by default).
 * We'll lazy-load videos & images on expansion.
 */
function createSampleCard(sample) {
  const card = document.createElement("div");
  card.className = "card mb-4 shadow-sm border sample-card";

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

  // Final metrics
  body.appendChild(createFinalMetricsSection(sample));
  // Full A/V
  body.appendChild(createFullMediaSection(sample));
  // Window table
  body.appendChild(createWindowTableSection(sample));

  // We'll mark that we haven't lazy-loaded videos/images yet
  card.dataset.videosLoaded = "false";

  // Toggle expand/collapse
  header.addEventListener("click", () => {
    const isCollapsed = (body.style.display === "none");
    if (isCollapsed) {
      // Expand
      body.style.display = "block";
      icon.textContent = "▼";
      // Lazy load
      if (card.dataset.videosLoaded === "false") {
        lazyLoadMedia(card);
        card.dataset.videosLoaded = "true";
      }
    } else {
      // Collapse
      body.style.display = "none";
      icon.textContent = "▲";
    }
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// -----------------------------------------------------
// Lazy-load videos & images when user expands
// -----------------------------------------------------
function lazyLoadMedia(card) {
  // Videos
  const videos = card.querySelectorAll("video[data-video-url]");
  videos.forEach(v => (v.src = v.dataset.videoUrl));

  // Images
  const imgs = card.querySelectorAll("img[data-imgUrl]");
  imgs.forEach(img => (img.src = img.dataset.imgUrl));
}

/**
 * Final metrics section, including bar chart for final "softmax_probs" + cross entropy.
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

  // Cross Entropy & offset/rank
  const ceEl = document.createElement("div");
  ceEl.className = "mt-2";
  ceEl.innerHTML = `
    <strong>Cross Entropy:</strong> ${final.cross_entropy ?? "N/A"}<br/>
    <strong>Rank of Correct Class:</strong> ${final.rank_of_correct_class ?? "N/A"}
  `;
  container.appendChild(ceEl);

  // Stats
  const statsDiv = document.createElement("div");
  statsDiv.className = "mt-2 border-top pt-2";
  statsDiv.dataset.finalStats = ""; // We'll fill later in color update
  container.appendChild(statsDiv);

  return container;
}

/**
 * Full media section. We do NOT set src immediately; we store them in data-video-url
 * or data-imgUrl for lazyLoadMedia() to handle on expand.
 */
function createFullMediaSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";

  const title = document.createElement("h6");
  title.textContent = "Full Audio/Video";
  title.className = "fw-bold mb-2";
  container.appendChild(title);

  // Derive folder path from any window's video_path or default:
  let folderPath = `data/sample_${sample.sample_idx}`;
  const w = sample.window_metrics || [];
  if (w.length && w[0].video_path) {
    const m = w[0].video_path.match(/^(.*sample_\d+)\/.*$/);
    if (m) folderPath = m[1];
  }

  const fullVidPath = `${folderPath}/full_window.mp4`;
  const fullMelspecPath = `${folderPath}/melspectrogram_full.png`;

  // Video
  const vid = document.createElement("video");
  vid.width = 400;
  vid.controls = true;
  vid.className = "mb-2 d-block";
  vid.dataset.videoUrl = fullVidPath; // lazy
  vid.onerror = () => {
    vid.replaceWith(document.createTextNode("No full video found."));
  };
  container.appendChild(vid);

  // Spectrogram
  const img = document.createElement("img");
  img.width = 600;
  img.alt = "Full Melspectrogram";
  img.dataset.imgUrl = fullMelspecPath; // lazy
  img.onerror = () => {
    img.replaceWith(document.createTextNode("No full spectrogram found."));
  };
  container.appendChild(img);

  return container;
}

/**
 * Window table with:
 * - Confidence & offset as color-coded badges
 * - Cross entropy
 * - Softmax bar chart
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

    // Conf / offset stored so we can color them
    row.querySelector("[data-conf]").dataset.confValue = w.confidence ?? "null";
    row.querySelector("[data-offset]").dataset.offsetValue = w.offset_from_correct ?? "null";

    // Bar chart for softmax_probs
    const barTd = row.querySelector("[data-bar]");
    if (w.softmax_probs) {
      const chartDiv = createSoftmaxBarChart(
        w.softmax_probs,
        w.ground_truth,
        w.predicted_class
      );
      barTd.appendChild(chartDiv);
    } else {
      barTd.textContent = "N/A";
    }

    // Video
    const videoTd = row.querySelector("[data-video]");
    if (w.video_path) {
      const vid = document.createElement("video");
      vid.width = 150;
      vid.controls = true;
      vid.dataset.videoUrl = w.video_path;
      vid.onerror = () => {
        vid.replaceWith(document.createTextNode("No data"));
      };
      videoTd.appendChild(vid);
    } else {
      videoTd.textContent = "N/A";
    }

    // Melspec
    const melspecTd = row.querySelector("[data-melspec]");
    if (w.melspectrogram_path) {
      const img = document.createElement("img");
      img.width = 150;
      img.alt = "Melspec";
      img.dataset.imgUrl = w.melspectrogram_path;
      img.onerror = () => {
        img.replaceWith(document.createTextNode("No data"));
      };
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
 * Creates a small "bar chart" of the softmax array.
 * - highest bar: red if it's not the ground truth, green if it matches ground truth
 * - ground truth bar: yellow if not top, else green if it is top
 */
function createSoftmaxBarChart(probs, groundTruth, predictedClass) {
  // Find index of max prob
  let maxVal = -Infinity;
  let maxIdx = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > maxVal) {
      maxVal = probs[i];
      maxIdx = i;
    }
  }

  // We'll make a row of bars
  // each bar is ~ 30px high * prob ? or do a width-based approach?
  // Let's do a horizontal bar with width scaled by prob
  const container = document.createElement("div");
  container.className = "d-flex flex-row align-items-end flex-wrap";
  container.style.maxWidth = "250px";
  container.style.gap = "2px";

  const highestIsCorrect = (maxIdx === groundTruth);

  for (let i = 0; i < probs.length; i++) {
    const bar = document.createElement("div");
    const p = probs[i];
    const scaledWidth = Math.round(p * 100); // 0-100%

    // Decide color:
    // - if i == maxIdx && i == groundTruth => green
    // - else if i == maxIdx => red
    // - else if i == groundTruth => yellow
    // - else gray
    let bgColor = "#ccc";
    if (i === maxIdx && i === groundTruth) {
      bgColor = "green";
    } else if (i === maxIdx) {
      bgColor = "red";
    } else if (i === groundTruth) {
      bgColor = "gold"; // or "yellow"
    }

    bar.style.backgroundColor = bgColor;
    bar.style.height = "12px";
    bar.style.width = scaledWidth + "%"; // scale by prob
    bar.style.flex = "0 0 auto"; // keep bars in row
    bar.title = `Class ${i}: ${(p*100).toFixed(1)}%`;

    container.appendChild(bar);
  }

  return container;
}

// -----------------------------------------------------
// Lazy load expansions
// -----------------------------------------------------
function lazyLoadMedia(card) {
  // videos
  const vids = card.querySelectorAll("video[data-video-url]");
  vids.forEach(v => (v.src = v.dataset.videoUrl));
  // images
  const imgs = card.querySelectorAll("img[data-imgUrl]");
  imgs.forEach(img => (img.src = img.dataset.imgUrl));
}

// -----------------------------------------------------
// UI
// -----------------------------------------------------
function setupUI() {
  // Threshold changes => recolor badges
  document.getElementById("offset-threshold-almost").addEventListener("change", e => {
    offsetThresholdAlmost = parseFloat(e.target.value) || 1;
    updateAllCardColors();
  });
  document.getElementById("offset-threshold-verywrong").addEventListener("change", e => {
    offsetThresholdVeryWrong = parseFloat(e.target.value) || 3;
    updateAllCardColors();
  });
  document.getElementById("conf-threshold-high").addEventListener("change", e => {
    highConfidenceThreshold = parseFloat(e.target.value) || 0.75;
    updateAllCardColors();
  });
  document.getElementById("conf-threshold-low").addEventListener("change", e => {
    lowConfidenceThreshold = parseFloat(e.target.value) || 0.25;
    updateAllCardColors();
  });

  // Filters
  [
    "filter-turnaround", "filter-lowConf", "filter-midConf", "filter-highConf",
    "filter-hasVideo", "filter-correct", "filter-almost", "filter-incorrect"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      applyFilters();
      renderGlobalStats(getFilteredSamples());
    });
  });
  document.getElementById("btn-apply-filters").addEventListener("click", () => {
    applyFilters();
    renderGlobalStats(getFilteredSamples());
  });
  document.getElementById("btn-reset-filters").addEventListener("click", resetFilters);

  // Collapse / Expand all
  document.getElementById("btn-collapse-all").addEventListener("click", () => toggleAllCards(false));
  document.getElementById("btn-expand-all").addEventListener("click", () => toggleAllCards(true));
}

function resetFilters() {
  document.getElementById("offset-threshold-almost").value = 1;
  document.getElementById("offset-threshold-verywrong").value = 3;
  document.getElementById("conf-threshold-high").value = 0.75;
  document.getElementById("conf-threshold-low").value = 0.25;

  offsetThresholdAlmost = 1;
  offsetThresholdVeryWrong = 3;
  highConfidenceThreshold = 0.75;
  lowConfidenceThreshold = 0.25;

  [
    "filter-turnaround", "filter-hasVideo"
  ].forEach(id => (document.getElementById(id).checked = false));

  [
    "filter-lowConf", "filter-midConf", "filter-highConf",
    "filter-correct", "filter-almost", "filter-incorrect"
  ].forEach(id => (document.getElementById(id).checked = true));

  document.getElementById("filter-sample-index").value = "";

  updateAllCardColors();
  applyFilters();
  renderGlobalStats(getFilteredSamples());
}

// -----------------------------------------------------
// Filtering
// -----------------------------------------------------
function applyFilters() {
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
    sampleIndexFilter = sampleIndexInput.split(",").map(s => parseInt(s.trim(), 10));
    sampleIndexFilter = sampleIndexFilter.filter(n => !isNaN(n));
  }

  allSamples.forEach(s => {
    const pass = doesSamplePassFilter(
      s,
      onlyTurnaround, showLow, showMid, showHigh, onlyHasVideo,
      showCorrect, showAlmost, showVeryWrong,
      sampleIndexFilter
    );
    sampleCards[s.sample_idx].style.display = pass ? "block" : "none";
  });
}

function doesSamplePassFilter(
  sample,
  onlyTurnaround, showLow, showMid, showHigh, onlyHasVideo,
  showCorrect, showAlmost, showVeryWrong,
  sampleIndexFilter
) {
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const conf = final.confidence ?? 0;

  // Turnaround check
  if (onlyTurnaround) {
    const w = sample.window_metrics || [];
    const nW = w.length;
    const nCorrect = w.filter(x => x.correct).length;
    const majorityWrong = (nCorrect < nW/2);
    const finalCorrect = (offset === 0);
    const isTurnaround = (majorityWrong && finalCorrect);
    if (!isTurnaround) return false;
  }

  // Confidence category
  const confCat = getConfidenceCategory(conf);
  if (confCat === "low" && !showLow) return false;
  if (confCat === "mid" && !showMid) return false;
  if (confCat === "high" && !showHigh) return false;

  // Offset category
  const offCat = getOffsetCategory(offset);
  if (offCat === "correct" && !showCorrect) return false;
  if (offCat === "almost" && !showAlmost) return false;
  if (offCat === "veryWrong" && !showVeryWrong) return false;

  // "Only samples w/ video" filter
  if (onlyHasVideo) {
    // Check if any window_metrics have non-empty video_path
    const hasAnyVideo = (sample.window_metrics || []).some(w => w.video_path);
    if (!hasAnyVideo) return false;
  }

  // Sample index filter
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

// -----------------------------------------------------
// Re-color offset/conf in final & window table badges
// -----------------------------------------------------
function updateAllCardColors() {
  allSamples.forEach(s => {
    const cardEl = sampleCards[s.sample_idx];
    updateCardColors(s, cardEl);
  });
}

function updateCardColors(sample, cardEl) {
  // Final metrics
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const conf = final.confidence;

  // Fill final columns
  const leftDiv = cardEl.querySelector("[data-final-left]");
  const rightDiv = cardEl.querySelector("[data-final-right]");
  const statsDiv = cardEl.querySelector("[data-final-stats]");
  if (leftDiv && rightDiv && statsDiv) {
    leftDiv.innerHTML = `
      <div><strong>Ground Truth:</strong> ${final.ground_truth ?? "N/A"}</div>
      <div><strong>Predicted:</strong> ${final.predicted_class ?? "N/A"}</div>
    `;

    // Correct? => color-coded
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

    // Window stats
    const { offset: offStats, confidence: confStats } = sample.stats;
    statsDiv.innerHTML = `
      <strong>Window Stats (Offset):</strong>
        min=${fmtStat(offStats.min)} /
        max=${fmtStat(offStats.max)} /
        mean=${fmtStat(offStats.mean)} /
        std=${fmtStat(offStats.std)}<br/>
      <strong>Window Stats (Confidence):</strong>
        min=${fmtStat(confStats.min,3)} /
        max=${fmtStat(confStats.max,3)} /
        mean=${fmtStat(confStats.mean,3)} /
        std=${fmtStat(confStats.std,3)}
    `;
  }

  // Window rows
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
// Color classes
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
function fmtStat(val, decimals=2) {
  if (val === null || isNaN(val)) return "N/A";
  return val.toFixed(decimals);
}

// -----------------------------------------------------
// Collapse/Expand all
// -----------------------------------------------------
function toggleAllCards(expand) {
  Object.values(sampleCards).forEach(cardEl => {
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
}

// -----------------------------------------------------
// Global stats on the currently visible (unfiltered) samples
// -----------------------------------------------------
function renderGlobalStats(filteredSamples) {
  const el = document.getElementById("global-stats");
  if (!filteredSamples.length) {
    el.innerHTML = "No samples available with current filters.";
    return;
  }

  let countCorrect = 0;
  let sumConf = 0;
  let sumOffset = 0;
  let validOffs = 0;

  filteredSamples.forEach(s => {
    const fin = s.final_metrics || {};
    const off = fin.offset_from_correct;
    const c = fin.confidence;
    if (off === 0) countCorrect++;
    if (typeof off === "number") {
      sumOffset += off;
      validOffs++;
    }
    if (typeof c === "number") {
      sumConf += c;
    }
  });

  const n = filteredSamples.length;
  const accuracy = (countCorrect / n) * 100;
  const avgConf = sumConf / n;
  const avgOff = validOffs > 0 ? sumOffset / validOffs : NaN;

  el.innerHTML = `
    <strong>Total Samples:</strong> ${n}<br/>
    <strong>Accuracy (final predictions):</strong> ${accuracy.toFixed(1)}%<br/>
    <strong>Average Final Confidence:</strong> ${isNaN(avgConf) ? "N/A" : avgConf.toFixed(3)}<br/>
    <strong>Average Offset:</strong> ${isNaN(avgOff) ? "N/A" : avgOff.toFixed(2)}
  `;
}

/** Return array of samples currently displayed (not filtered out). */
function getFilteredSamples() {
  return allSamples.filter(s => {
    const cardEl = sampleCards[s.sample_idx];
    return (cardEl.style.display !== "none");
  });
}
