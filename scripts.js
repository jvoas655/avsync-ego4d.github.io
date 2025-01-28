// scripts.js

// Simple thresholds you can tweak
const ALMOST_CORRECT_OFFSET = 1;
const VERY_INCORRECT_OFFSET = 3;
const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const LOW_CONFIDENCE_THRESHOLD = 0.25;

document.addEventListener("DOMContentLoaded", () => {
  // 1. Load the JSON data
  fetch("data/samples.json")
    .then(resp => resp.json())
    .then(data => {
      renderSamples(data);
      attachFilterHandlers(data);
    })
    .catch(err => console.error("Failed2 to load data:", err));
});

function renderSamples(samples) {
  const container = document.getElementById("sample-container");
  container.innerHTML = ""; // Clear existing

  samples.forEach(sample => {
    const sampleCard = createSampleCard(sample);
    container.appendChild(sampleCard);
  });
}

function createSampleCard(sample) {
  // 2. We can extract some info from final metrics to see if it meets certain conditions
  const final = sample.final_metrics || {};
  const offset = final.offset_from_correct;
  const confidence = final.confidence;

  // A simple classification of final correctness:
  // "correct" vs "almost" vs "veryWrong"
  let correctnessCategory = "unknown";
  if (offset === 0) correctnessCategory = "correct";
  else if (offset <= ALMOST_CORRECT_OFFSET) correctnessCategory = "almost";
  else if (offset >= VERY_INCORRECT_OFFSET) correctnessCategory = "veryWrong";

  // A simple classification of final confidence:
  // "highConf" vs "lowConf" or neither
  let confidenceCategory = "normalConf";
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) confidenceCategory = "highConf";
  else if (confidence <= LOW_CONFIDENCE_THRESHOLD) confidenceCategory = "lowConf";

  // Also, check if "majority of windows were incorrect but final was correct"
  const windowMetrics = sample.window_metrics || [];
  const numWindows = windowMetrics.length;
  const numWindowsCorrect = windowMetrics.filter(w => w.correct === true).length;
  const majorityWrongFinalCorrect = (numWindowsCorrect < (numWindows / 2)) && (offset === 0);

  // 3. Build the outer DOM elements
  const wrapper = document.createElement("div");
  wrapper.className = `sample-card ${correctnessCategory} ${confidenceCategory} ${
    majorityWrongFinalCorrect ? "turnaround" : ""
  }`;
  wrapper.style.border = "1px solid #ccc";
  wrapper.style.padding = "10px";
  wrapper.style.marginBottom = "20px";

  const header = document.createElement("h2");
  header.textContent = `Sample #${sample.sample_idx}`;
  wrapper.appendChild(header);

  // Final metrics summary
  const finalInfo = document.createElement("p");
  finalInfo.innerHTML = `
    <strong>Final Prediction:</strong> ${final.predicted_class} 
    (ground truth: ${final.ground_truth})<br>
    <strong>Confidence:</strong> ${final.confidence.toFixed(3)}<br>
    <strong>Offset from correct:</strong> ${final.offset_from_correct}<br>
    <strong>Correct?</strong> ${final.correct ? "Yes" : "No"}
  `;
  wrapper.appendChild(finalInfo);

  // If you recorded a "full_window.mp4" or "melspectrogram_full.png",
  // you could embed them similarly. 
  // e.g. <video src="sample_XX/full_window.mp4" controls></video>

  // Show per-window metrics in a small table
  const table = document.createElement("table");
  table.border = "1";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Iter</th>
      <th>Pred Class</th>
      <th>GT</th>
      <th>Conf</th>
      <th>Correct?</th>
      <th>Offset</th>
      <th>Video</th>
      <th>Mel-Spec</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  windowMetrics.forEach(wm => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${wm.iteration}</td>
      <td>${wm.predicted_class}</td>
      <td>${wm.ground_truth}</td>
      <td>${wm.confidence ? wm.confidence.toFixed(3) : ""}</td>
      <td>${wm.correct ? "Yes" : "No"}</td>
      <td>${wm.offset_from_correct || ""}</td>
      <td>
        ${
          wm.video_path 
            ? `<video src="${wm.video_path}" controls width="200"></video>` 
            : "N/A"
        }
      </td>
      <td>
        ${
          wm.melspectrogram_path
            ? `<img src="${wm.melspectrogram_path}" alt="Mel Spectrogram" width="200"/>`
            : "N/A"
        }
      </td>
    `;
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  wrapper.appendChild(table);

  return wrapper;
}

// Optional: filter toggles
function attachFilterHandlers(allSamples) {
  const correctCb = document.getElementById("filter-correct");
  const almostCb = document.getElementById("filter-almost");
  const wrongCb = document.getElementById("filter-incorrect");
  const highConfCb = document.getElementById("filter-confident");
  const lowConfCb = document.getElementById("filter-unconfident");
  const turnaroundCb = document.getElementById("filter-majority-wrong-final-correct");

  const refresh = () => {
    const filtered = allSamples.filter(s => {
      // Get categories from the sample’s final metrics
      const offset = (s.final_metrics || {}).offset_from_correct;
      const confidence = (s.final_metrics || {}).confidence || 0;
      const correct = offset === 0;
      const almost = !correct && offset <= ALMOST_CORRECT_OFFSET;
      const veryWrong = offset >= VERY_INCORRECT_OFFSET;
      const highConf = confidence >= HIGH_CONFIDENCE_THRESHOLD;
      const lowConf = confidence <= LOW_CONFIDENCE_THRESHOLD;

      const wm = s.window_metrics || [];
      const numWindows = wm.length;
      const numCorrect = wm.filter(x => x.correct).length;
      const majorityWrong = (numCorrect < (numWindows / 2));
      const finalIsCorrect = correct;
      const isTurnaround = majorityWrong && finalIsCorrect;

      // Decide if we keep it based on checkboxes
      if (!correctCb.checked && correct) return false;
      if (!almostCb.checked && almost) return false;
      if (!wrongCb.checked && veryWrong) return false;
      if (!highConfCb.checked && highConf) return false;
      if (!lowConfCb.checked && lowConf) return false;
      if (!turnaroundCb.checked && isTurnaround) return false;

      // If it didn’t fail any of the above “turn-off” filters, it stays
      return true;
    });

    renderSamples(filtered);
  };

  correctCb.addEventListener("change", refresh);
  almostCb.addEventListener("change", refresh);
  wrongCb.addEventListener("change", refresh);
  highConfCb.addEventListener("change", refresh);
  lowConfCb.addEventListener("change", refresh);
  turnaroundCb.addEventListener("change", refresh);

  // Initial render
  refresh();
}
