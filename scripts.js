// -----------------------------------------------------
// Global threshold variables
// -----------------------------------------------------
let offsetThresholdAlmost = 1;
let offsetThresholdVeryWrong = 3;
let highConfidenceThreshold = 0.75;
let lowConfidenceThreshold = 0.25;

// We'll store the sample data, and for each sample, a "card" in the DOM
let allSamples = [];
let sampleCards = {}; // sample_idx -> DOM element

document.addEventListener("DOMContentLoaded", () => {
  // Load the JSON
  fetch("data/samples.json")
    .then(res => res.json())
    .then(data => {
      allSamples = data;
      // Precompute stats for each sample
      allSamples.forEach(computeSampleStats);

      // Create cards for each sample exactly once
      createAllSampleCards();

      // Setup UI event listeners
      setupUI();

      // Initial color update & filter apply
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
// Stats computation for each sample
// -----------------------------------------------------
function computeSampleStats(sample) {
  const windows = sample.window_metrics || [];
  const offsets = [];
  const confs = [];

  windows.forEach(w => {
    if (typeof w.offset_from_correct === "number") offsets.push(w.offset_from_correct);
    if (typeof w.confidence === "number") confs.push(w.confidence);
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
  const mean = values.reduce((a,b) => a + b, 0) / values.length;
  const variance = values.reduce((acc,val) => acc + (val - mean)**2, 0) / values.length;
  return {
    min,
    max,
    mean,
    std: Math.sqrt(variance)
  };
}

// -----------------------------------------------------
// Create all sample cards (once) and store them
// -----------------------------------------------------
function createAllSampleCards() {
  const container = document.getElementById("sample-container");
  container.innerHTML = "";

  allSamples.forEach(sample => {
    // Build the card DOM
    const card = createSampleCard(sample);
    // Store reference
    sampleCards[sample.sample_idx] = card;
    // Append to container
    container.appendChild(card);
  });
}

/**
 * Create a single sample card, but do not set the video src immediately.
 * We'll lazy-load videos upon expansion.
 */
function createSampleCard(sample) {
  const card = document.createElement("div");
  card.className = "card mb-4 shadow-sm border sample-card";

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

  // Body
  const body = document.createElement("div");
  body.className = "card-body collapse-body";
  body.style.display = "none"; // start collapsed
  body.innerHTML = ""; // We'll fill below

  // Final Metrics section
  const finalSection = createFinalMetricsSection(sample);
  body.appendChild(finalSection);

  // Full A/V section
  const fullMediaSection = createFullMediaSection(sample);
  body.appendChild(fullMediaSection);

  // Window table
  const windowSection = createWindowTableSection(sample);
  body.appendChild(windowSection);

  // Store a flag indicating we haven't loaded videos yet
  card.dataset.videosLoaded = "false";

  // Toggle expand/collapse
  header.addEventListener("click", () => {
    const isCollapsed = (body.style.display === "none");
    if (isCollapsed) {
      // Expand
      body.style.display = "block";
      icon.textContent = "▼";

      // Lazy load videos if not already done
      if (card.dataset.videosLoaded === "false") {
        lazyLoadVideosForCard(card);
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

/**
 * Called the first time a card is expanded. 
 * We set the .src for the videos in the "Full A/V" section and the window table.
 */
function lazyLoadVideosForCard(card) {
  // Find all <video> elements that have data-video-path or data-full-av
  const videos = card.querySelectorAll("video[data-video-url]");
  videos.forEach(video => {
    const url = video.dataset.videoUrl;
    video.src = url; // now the browser actually fetches it
  });
}

/**
 * Final metrics section. 
 * (All text, no video loading here.)
 */
function createFinalMetricsSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";
  container.innerHTML = `
    <h6 class="mb-2 fw-bold">Final Metrics</h6>
    <!-- We'll inject the text/badges dynamically below. -->
  `;

  const details = document.createElement("div");
  details.className = "row g-2";
  // We'll fill in text & color-coded badges when we do "updateAllCardColors()"
  details.innerHTML = `
    <div class="col-sm-6" data-final-left></div>
    <div class="col-sm-6" data-final-right></div>
    <div class="mt-3 border-top pt-2" data-final-stats></div>
  `;
  container.appendChild(details);

  return container;
}

/**
 * Full A/V section, but do NOT set src. Use data-video-url or data-img-url for lazy load.
 */
function createFullMediaSection(sample) {
  const container = document.createElement("div");
  container.className = "mb-3";

  const title = document.createElement("h6");
  title.textContent = "Full Audio/Video";
  title.className = "fw-bold mb-2";
  container.appendChild(title);

  // Attempt to derive folder path from the first window video path:
  let folderPath = `data/sample_${sample.sample_idx}`;
  const w = sample.window_metrics || [];
  if (w.length && w[0].video_path) {
    const m = w[0].video_path.match(/^(.*sample_\d+)\/.*$/);
    if (m) {
      folderPath = m[1];
    }
  }
  const fullVidPath = `${folderPath}/full_window.mp4`;
  const fullMelspecPath = `${folderPath}/melspectrogram_full.png`;

  const video = document.createElement("video");
  video.width = 400;
  video.controls = true;
  // Instead of video.src, store it in data- attribute
  video.dataset.videoUrl = fullVidPath;
  video.className = "mb-2 d-block";
  // onerror => show "No data" if 404
  video.onerror = () => {
    video.replaceWith(document.createTextNode("No data found for full video."));
  };
  container.appendChild(video);

  const img = document.createElement("img");
  img.width = 600;
  img.alt = "Full Melspectrogram";
  // If the image 404s, remove it
  img.onerror = () => {
    img.replaceWith(document.createTextNode("No full melspectrogram found."));
  };
  img.src = ""; // not set for lazy load? Actually, images don't auto-play. 
  // But if you want to also lazy-load the image, you can store it in a data-attr as well:
  // Let's do that:
  img.dataset.imgUrl = fullMelspecPath;
  // We'll set it on expand. We'll do the same approach in lazyLoadVideosForCard.

  container.appendChild(img);

  return container;
}

/**
 * Window table, storing video paths in data-video-url for lazy load.
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
  table.className = "table table-striped table-bordered table-sm align-middle";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr class="table-secondary">
      <th>Iter</th>
      <th>Pred Class</th>
      <th>GT</th>
      <th>Confidence</th>
      <th>Offset</th>
      <th>Correct?</th>
      <th>Video</th>
      <th>Melspec</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  windows.forEach(w => {
    const row = document.createElement("tr");

    // We'll place placeholders for confidence & offset badges that we color later
    row.innerHTML = `
      <td>${w.iteration ?? ""}</td>
      <td>${w.predicted_class ?? ""}</td>
      <td>${w.ground_truth ?? ""}</td>
      <td data-conf></td>
      <td data-offset></td>
      <td data-correct></td>
      <td data-video></td>
      <td data-melspec></td>
    `;
    // We'll color the badges in "updateAllCardColors()"

    // Correct? => badge
    const correctTd = row.querySelector("[data-correct]");
    correctTd.innerHTML = w.correct
      ? `<span class="badge bg-success">Yes</span>`
      : `<span class="badge bg-danger">No</span>`;

    // For the video & melspec columns, we do data attributes
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

    // We'll store offset/conf in dataset so we can color them easily
    row.querySelector("[data-offset]").dataset.offsetValue = w.offset_from_correct ?? "null";
    row.querySelector("[data-conf]").dataset.confValue = w.confidence ?? "null";

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
  return container;
}

// -----------------------------------------------------
// Lazy-load final function (set src for data-video-url, data-imgUrl) on expand
// -----------------------------------------------------
function lazyLoadVideosForCard(card) {
  // videos
  const videos = card.querySelectorAll("video[data-video-url]");
  videos.forEach(vid => {
    vid.src = vid.dataset.videoUrl;
  });
  // images
  const imgs = card.querySelectorAll("img[data-imgUrl]");
  imgs.forEach(img => {
    img.src = img.dataset.imgUrl;
  });
}

// -----------------------------------------------------
// UI event setup
// -----------------------------------------------------
function setupUI() {
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

  // Filter checkboxes & apply button
  [
    "filter-turnaround", "filter-lowConf", "filter-midConf", "filter-highConf",
    "filter-correct", "filter-almost", "filter-incorrect"
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

  // Collapse/Expand all
  document.getElementById("btn-collapse-all").addEventListener("click", () => toggleAllCards(false));
  document.getElementById("btn-expand-all").addEventListener("click", () => toggleAllCards(true));
}

function resetFilters() {
  document.getElementById("filter-turnaround").checked = false;
  document.getElementById("filter-lowConf").checked = true;
  document.getElementById("filter-midConf").checked = true;
  document.getElementById("filter-highConf").checked = true;
  document.getElementById("filter-correct").checked = true;
  document.getElementById("filter-almost").checked = true;
  document.getElementById("filter-incorrect").checked = true;

  document.getElementById("offset-threshold-almost").value = 1;
  document.getElementById("offset-threshold-verywrong").value = 3;
  document.getElementById("conf-threshold-high").value = 0.75;
  document.getElementById("conf-threshold-low").value = 0.25;

  offsetThresholdAlmost = 1;
  offsetThresholdVeryWrong = 3;
  highConfidenceThreshold = 0.75;
  lowConfidenceThreshold = 0.25;

  document.getElementById("filter-sample-index").value = "";

  updateAllCardColors();
  applyFilters();
  renderGlobalStats(getFilteredSamples());
}

// -----------------------------------------------------
// Filtering
// -----------------------------------------------------
function applyFilters() {
  const sampleIndexInput = document.getElementById("filter-sample-index").value.trim();
  let sampleIndexFilter = null;
  if (sampleIndexInput) {
    sampleIndexFilter = sampleIndexInput.split(",").map(s => parseInt(s.trim(), 10));
    sampleIndexFilter = sampleIndexFilter.filter(n => !isNaN(n));
  }

  // Turnaround
  const onlyTurnaround = document.getElementById("filter-turnaround").checked;

  // Confidence checkboxes
  const showLow = document.getElementById("filter-lowConf").checked;
  const showMid = document.getElementById("filter-midConf").checked;
  const showHigh = document.getElementById("filter-highConf").checked;

  // Offset checkboxes
  const showCorrect = document.getElementById("filter-correct").checked;
  const showAlmost = document.getElementById("filter-almost").checked;
  const showVeryWrong = document.getElementById("filter-incorrect").checked;

  allSamples.forEach(sample => {
    // Decide if sample should be shown
    const pass = doesSamplePassFilter(
      sample,
      sampleIndexFilter,
      onlyTurnaround,
      showLow, showMid, showHigh,
      showCorrect, showAlmost, showVeryWrong
    );
    const cardEl = sampleCards[sample.sample_idx];
    cardEl.style.display = pass ? "block" : "none";
  });
}

/** Return true if sample passes all the filters. */
function doesSamplePassFilter(
  sample,
  sampleIndexFilter,
  onlyTurnaround,
  showLow, showMid, showHigh,
  showCorrect, showAlmost, showVeryWrong
) {
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const conf = final.confidence || 0;

  // Turnaround check
  if (onlyTurnaround) {
    const windows = sample.window_metrics || [];
    const nW = windows.length;
    const nCorrect = windows.filter(w => w.correct).length;
    const majorityWrong = (nCorrect < nW/2);
    const isCorrectFinal = (offset === 0);
    const isTurnaround = (majorityWrong && isCorrectFinal);
    if (!isTurnaround) return false;
  }

  // Confidence category
  const confCat = getConfidenceCategory(conf); // "low" / "mid" / "high"
  if (confCat === "low" && !showLow) return false;
  if (confCat === "mid" && !showMid) return false;
  if (confCat === "high" && !showHigh) return false;

  // Offset category
  const offCat = getOffsetCategory(offset);
  if (offCat === "correct" && !showCorrect) return false;
  if (offCat === "almost" && !showAlmost) return false;
  if (offCat === "veryWrong" && !showVeryWrong) return false;

  // Sample index filter
  if (sampleIndexFilter && sampleIndexFilter.length > 0) {
    if (!sampleIndexFilter.includes(sample.sample_idx)) return false;
  }

  return true;
}

// Same logic as before
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
// Update color badges (offset/conf) in final metrics & window table
// whenever thresholds change
// -----------------------------------------------------
function updateAllCardColors() {
  allSamples.forEach(sample => {
    const cardEl = sampleCards[sample.sample_idx];
    updateCardColors(sample, cardEl);
  });
}

/**
 * Re-color offset/conf badges in final metrics & window rows
 */
function updateCardColors(sample, cardEl) {
  // Final metrics
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const conf = final.confidence;

  // Fill in final metrics left / right columns
  const leftCol = cardEl.querySelector("[data-final-left]");
  const rightCol = cardEl.querySelector("[data-final-right]");
  const statsDiv = cardEl.querySelector("[data-final-stats]");

  if (leftCol && rightCol && statsDiv) {
    leftCol.innerHTML = `
      <div><strong>Ground Truth:</strong> ${final.ground_truth ?? "N/A"}</div>
      <div><strong>Predicted:</strong> ${final.predicted_class ?? "N/A"}</div>
    `;
    const correctBadgeClass = (offset === 0) ? "bg-success" : "bg-danger";
    const correctText = (offset === 0) ? "Yes" : "No";

    const offsetBadgeClass = getOffsetColorClass(offset);
    const offsetText = (offset !== null && offset !== undefined) ? offset : "N/A";

    const confBadgeClass = getConfidenceColorClass(conf);
    const confText = (conf !== undefined && conf !== null) ? conf.toFixed(3) : "N/A";

    rightCol.innerHTML = `
      <div><strong>Correct?</strong> 
        <span class="badge ${correctBadgeClass}">${correctText}</span>
      </div>
      <div><strong>Offset:</strong> 
        <span class="badge ${offsetBadgeClass}">${offsetText}</span>
      </div>
      <div><strong>Confidence:</strong> 
        <span class="badge ${confBadgeClass}">${confText}</span>
      </div>
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
  const tableRows = cardEl.querySelectorAll("tr");
  tableRows.forEach(row => {
    const offsetTd = row.querySelector("[data-offset]");
    const confTd = row.querySelector("[data-conf]");
    if (offsetTd) {
      const offVal = offsetTd.dataset.offsetValue;
      if (offVal !== "null") {
        const offNum = parseFloat(offVal);
        const cls = getOffsetColorClass(offNum);
        offsetTd.innerHTML = `<span class="badge ${cls}">${offNum}</span>`;
      } else {
        offsetTd.innerHTML = `<span class="badge bg-secondary">N/A</span>`;
      }
    }
    if (confTd) {
      const confVal = confTd.dataset.confValue;
      if (confVal !== "null") {
        const cNum = parseFloat(confVal);
        const cls = getConfidenceColorClass(cNum);
        confTd.innerHTML = `<span class="badge ${cls}">${cNum.toFixed(3)}</span>`;
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
      // If we haven't loaded videos yet, do it
      if (cardEl.dataset.videosLoaded === "false") {
        lazyLoadVideosForCard(cardEl);
        cardEl.dataset.videosLoaded = "true";
      }
    } else {
      body.style.display = "none";
      if (icon) icon.textContent = "▲";
    }
  });
}

// -----------------------------------------------------
// Compute & display global stats on the currently visible samples
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
  let validOffsets = 0;

  filteredSamples.forEach(s => {
    const final = s.final_metrics || {};
    const off = final.offset_from_correct;
    const c = final.confidence;
    if (off === 0) countCorrect++;
    if (typeof off === "number") {
      sumOffset += off;
      validOffsets++;
    }
    if (typeof c === "number") {
      sumConf += c;
    }
  });

  const n = filteredSamples.length;
  const accuracy = (countCorrect / n) * 100;
  const avgConf = sumConf / n;
  const avgOffset = (validOffsets > 0) ? (sumOffset / validOffsets) : NaN;

  el.innerHTML = `
    <strong>Total Samples:</strong> ${n}<br/>
    <strong>Accuracy (final predictions):</strong> ${accuracy.toFixed(1)}%<br/>
    <strong>Average Final Confidence:</strong> ${isNaN(avgConf) ? "N/A" : avgConf.toFixed(3)}<br/>
    <strong>Average Offset (among valid offsets):</strong> ${isNaN(avgOffset) ? "N/A" : avgOffset.toFixed(2)}
  `;
}

/** Return an array of samples that are currently displayed (not filtered out). */
function getFilteredSamples() {
  // We check which cards are visible
  return allSamples.filter(s => {
    const cardEl = sampleCards[s.sample_idx];
    return (cardEl.style.display !== "none");
  });
}
